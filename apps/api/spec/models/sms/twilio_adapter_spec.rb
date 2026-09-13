require "rails_helper"

RSpec.describe Sms::TwilioAdapter do
  subject(:adapter) { described_class.new }

  def deliver
    adapter.deliver(to: "+15005550006", body: "Bins tomorrow", status_callback: Sms.status_callback_url)
  end

  it "returns the SID and status Twilio gave it" do
    stub_twilio_send(sid: "SM00000000000000000000000000000001", status: "queued")

    expect(deliver).to have_attributes(sid: "SM00000000000000000000000000000001", status: "queued")
  end

  # The cost estimate that stands in until Twilio settles a real price, hours later. Twilio counts
  # the segments — encoding, length, and the one emoji that silently turns a text into three are its
  # arithmetic, not ours — so the number is read off the response rather than computed here.
  it "returns the segment count Twilio counted, as a number" do
    stub_twilio_send(num_segments: "3")

    expect(deliver.num_segments).to eq(3)
  end

  it "leaves the segment count nil when Twilio did not report one" do
    stub_twilio_send(num_segments: nil)

    expect(deliver.num_segments).to be_nil
  end

  # The other half of the spend story: what Twilio actually charged, which only exists after the
  # fact and has to be asked for.
  describe "#fetch_price" do
    let(:sid) { "SM00000000000000000000000000000007" }

    it "returns Twilio's charge as a positive amount with its currency" do
      stub_twilio_fetch(sid: sid, price: "-0.00790", price_unit: "USD")

      price = adapter.fetch_price(sid)

      expect(price.amount).to eq(BigDecimal("0.0079"))
      expect(price.unit).to eq("USD")
    end

    it "reads the message rather than sending one" do
      stub_twilio_fetch(sid: sid)

      adapter.fetch_price(sid)

      expect(a_request(:get, twilio_message_url(sid))).to have_been_made
      expect(a_request(:post, TwilioStubs::MESSAGES_URL_PATTERN)).not_to have_been_made
    end

    it "returns nil when Twilio has the message but has not priced it yet" do
      stub_twilio_fetch(sid: sid, price: nil, price_unit: nil, status: "sent")

      expect(adapter.fetch_price(sid)).to be_nil
    end

    it "raises MessageNotFound when Twilio has no record of the SID" do
      stub_twilio_fetch_missing(sid: sid)

      expect { adapter.fetch_price(sid) }.to raise_error(Sms::MessageNotFound, /#{sid}/)
    end

    it "treats a 429 as transient, because it means slow down rather than no" do
      stub_twilio_fetch_error(sid: sid, status: 429, code: 20_429)

      expect { adapter.fetch_price(sid) }.to raise_error(Sms::TransientFailure)
    end

    it "treats a 5xx as transient" do
      stub_twilio_fetch_error(sid: sid, status: 500, code: 20_500, message: "Internal Server Error")

      expect { adapter.fetch_price(sid) }.to raise_error(Sms::TransientFailure)
    end

    it "treats another 4xx as permanent, because the answer will not change" do
      stub_twilio_fetch_error(sid: sid, status: 400, code: 20_001, message: "Invalid parameter")

      expect { adapter.fetch_price(sid) }.to raise_error(Sms::PermanentFailure)
    end

    # Sms::PriceBackfill holds one adapter for a whole walk precisely so this happens once. A client
    # per message means a TLS handshake per message across a thirteen-month history.
    it "builds one Twilio client however many messages it is asked about" do
      second_sid = "SM00000000000000000000000000000008"
      allow(::Twilio::REST::Client).to receive(:new).and_call_original
      stub_twilio_fetch(sid: sid)
      stub_twilio_fetch(sid: second_sid)

      adapter.fetch_price(sid)
      adapter.fetch_price(second_sid)

      expect(::Twilio::REST::Client).to have_received(:new).once
    end
  end

  # The classification is the whole job of this class: everything downstream — retry or fail, once
  # or five times — follows from which of these two it raises.
  describe "what it makes of a refusal" do
    it "treats a 4xx as permanent, because Twilio will say the same thing next time" do
      stub_twilio_error(status: 400, code: 21_211, message: "Invalid 'To' Phone Number")

      expect { deliver }.to raise_error(Sms::PermanentFailure) { |error|
        expect(error.error_code).to eq("21211")
      }
    end

    it "treats a 429 as transient, because it means slow down rather than no" do
      stub_twilio_error(status: 429, code: 20_429, message: "Too Many Requests")

      expect { deliver }.to raise_error(Sms::TransientFailure)
    end

    it "treats a 5xx as transient" do
      stub_twilio_server_error

      expect { deliver }.to raise_error(Sms::TransientFailure)
    end

    it "treats a dropped connection as transient" do
      stub_request(:post, TwilioStubs::MESSAGES_URL_PATTERN).to_timeout

      expect { deliver }.to raise_error(Sms::TransientFailure)
    end
  end
end
