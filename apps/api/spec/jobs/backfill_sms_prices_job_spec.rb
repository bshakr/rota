require "rails_helper"
# Solid Queue's own schedule parser, required here so the spec below checks the schedule string
# against the thing that will actually read it rather than against a regex of our own.
require "fugit"

RSpec.describe BackfillSmsPricesJob do
  # Every row here is one that already went out: it has a SID because Twilio accepted it. The
  # question this job answers is what Twilio then charged for it.
  def sent_message(sid:, created_at: 1.day.ago, **attributes)
    create(:sms_message, :sent, twilio_sid: sid, created_at: created_at, **attributes)
  end

  it "enqueues on the default queue" do
    expect { described_class.perform_later }
      .to have_enqueued_job(described_class).on_queue("default")
  end

  # The conversion the whole job exists for. Twilio reports a charge as a debit against the account
  # balance, so "-0.00790" is what it cost us, not what it gave back.
  it "stores Twilio's negative charge as a positive amount" do
    message = sent_message(sid: "SM00000000000000000000000000000001")
    stub_twilio_fetch(sid: message.twilio_sid, price: "-0.00790", price_unit: "USD")

    described_class.perform_now

    expect(message.reload.price).to eq(BigDecimal("0.0079"))
    expect(message.price_unit).to eq("USD")
    expect(message.price_fetched_at).to be_present
  end

  # Twilio settles a price minutes after delivery, and a sweep that ran in that gap must not write
  # the row off. Leaving price_fetched_at null is what puts it back in tomorrow's scope.
  it "leaves a row Twilio has not priced yet alone, for tomorrow" do
    message = sent_message(sid: "SM00000000000000000000000000000002")
    stub_twilio_fetch(sid: message.twilio_sid, price: nil, price_unit: nil, status: "sent")

    described_class.perform_now

    expect(message.reload).to have_attributes(price: nil, price_unit: nil, price_fetched_at: nil)
  end

  describe "which rows it asks about" do
    it "skips a row that never reached Twilio, because there is no message to price" do
      never_sent = create(:sms_message, twilio_sid: nil, status: "failed", error_code: "not_contactable")

      described_class.perform_now

      expect(never_sent.reload.price_fetched_at).to be_nil
      expect(a_request(:get, TwilioStubs::MESSAGE_URL_PATTERN)).not_to have_been_made
    end

    it "skips a row it has already asked about" do
      already = sent_message(sid: "SM00000000000000000000000000000003", price_fetched_at: 2.days.ago, price: BigDecimal("0.0079"))

      described_class.perform_now

      expect(a_request(:get, twilio_message_url(already.twilio_sid))).not_to have_been_made
    end

    # The nightly sweep is for prices that are still settling. Everything older is the one-off rake
    # task's job, and walking the whole history every night would be an unbounded sweep.
    it "skips a row older than the seven-day window" do
      old = sent_message(sid: "SM00000000000000000000000000000004", created_at: 8.days.ago)

      described_class.perform_now

      expect(a_request(:get, twilio_message_url(old.twilio_sid))).not_to have_been_made
    end
  end

  # Everything this job looks at was sent in the last seven days, so a 404 here is never a message
  # Twilio has forgotten — it is one Twilio does not recognise, which points at the account being
  # asked rather than at the row. Leave it exactly as it was. Sms::PriceBackfill's own spec covers
  # the far side of that horizon, which only the history backfill can reach.
  it "leaves a row Twilio does not recognise untouched, rather than writing it off" do
    message = sent_message(sid: "SM00000000000000000000000000000005")
    stub_twilio_fetch_missing(sid: message.twilio_sid)

    expect { described_class.perform_now }.not_to raise_error

    expect(message.reload).to have_attributes(price: nil, price_fetched_at: nil)
  end

  describe "when Twilio pushes back" do
    it "stops the sweep on a rate limit rather than hammering it, and does not raise" do
      first = sent_message(sid: "SM00000000000000000000000000000006", created_at: 3.days.ago)
      second = sent_message(sid: "SM00000000000000000000000000000007", created_at: 1.day.ago)
      stub_twilio_fetch_error(sid: first.twilio_sid, status: 429)
      stub_twilio_fetch(sid: second.twilio_sid)

      expect { described_class.perform_now }.not_to raise_error

      expect(a_request(:get, twilio_message_url(second.twilio_sid))).not_to have_been_made
      expect(first.reload.price_fetched_at).to be_nil
      expect(second.reload.price_fetched_at).to be_nil
    end

    it "carries on past one row Twilio refuses outright" do
      refused = sent_message(sid: "SM00000000000000000000000000000008", created_at: 3.days.ago)
      priced = sent_message(sid: "SM00000000000000000000000000000009", created_at: 1.day.ago)
      stub_twilio_fetch_error(sid: refused.twilio_sid, status: 400, code: 20_001, message: "Invalid parameter")
      stub_twilio_fetch(sid: priced.twilio_sid)

      expect { described_class.perform_now }.not_to raise_error

      expect(refused.reload.price_fetched_at).to be_nil
      expect(priced.reload.price).to eq(BigDecimal("0.0079"))
    end
  end

  # A sweep with no ceiling is a sweep that can hammer Twilio for as long as the backlog is deep.
  # What it does not finish stays unasked, which is exactly what tomorrow's run looks for.
  it "asks about no more rows than its per-run limit" do
    stub_const("Sms::PriceBackfill::DEFAULT_LIMIT", 1)
    oldest = sent_message(sid: "SM00000000000000000000000000000010", created_at: 3.days.ago)
    newer = sent_message(sid: "SM00000000000000000000000000000011", created_at: 1.day.ago)
    stub_twilio_fetch(sid: oldest.twilio_sid)
    stub_twilio_fetch(sid: newer.twilio_sid)

    described_class.perform_now

    expect(oldest.reload.price_fetched_at).to be_present
    expect(a_request(:get, twilio_message_url(newer.twilio_sid))).not_to have_been_made
  end

  it "is scheduled nightly" do
    config = YAML.load_file(Rails.root.join("config/recurring.yml"), aliases: true)
    entry = config.dig("production", "backfill_sms_prices")

    expect(entry).to include("class" => "BackfillSmsPricesJob", "queue" => "default")
    # Solid Queue parses the schedule with Fugit at boot, and a schedule it cannot parse is a job
    # that silently never runs.
    expect(Fugit.parse(entry["schedule"])).to be_a(Fugit::Cron)
  end
  # A rename here silently orphans the Sentry monitor: the old slug stops checking in and starts
  # alerting, and the new one quietly creates a second monitor nobody is watching. Cheap to assert.
  describe "the cron monitor" do
    it "checks in under the slug the monitor was created with" do
      expect(described_class.sentry_monitor_slug).to eq("backfill-sms-prices")
    end

    it "declares the schedule a missed check-in is measured against" do
      expect(described_class.sentry_monitor_config.to_h).to include(
        schedule: { type: :crontab, value: "40 4 * * *" },
        checkin_margin: 60,
        timezone: "UTC"
      )
    end
  end
end
