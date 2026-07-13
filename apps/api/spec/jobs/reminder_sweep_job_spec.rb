require "rails_helper"

# The hourly sweep across the whole system. ReminderSweep owns the per-rota reconciliation (and is
# tested exhaustively there); this covers what the JOB adds — running every active rota, keeping one
# rota's failure from starving the rest, and being wired into the recurring schedule.
RSpec.describe ReminderSweepJob do
  include ActiveJob::TestHelper

  let(:group) { create(:group, timezone: "Europe/London") }

  def reminder_for(shift, days_before)
    shift.sms_messages.reminder.find_by(days_before: days_before)
  end

  it "enqueues on the default queue" do
    expect { described_class.perform_later }
      .to have_enqueued_job(described_class).on_queue("default")
  end

  it "sweeps an active rota's due reminders" do
    rota = create(:rota, group: group, send_hour: 9, reminder_offsets: [ 0 ])
    shift = create(:shift, rota: rota, due_on: Date.new(2026, 7, 15))

    travel_to(Time.utc(2026, 7, 15, 8, 0)) do # 09:00 BST
      expect { described_class.perform_now }.to have_enqueued_job(SendSmsJob)
      expect(reminder_for(shift, 0)).to be_present
    end
  end

  it "leaves an inactive rota alone" do
    rota = create(:rota, :inactive, group: group, send_hour: 9, reminder_offsets: [ 0 ])
    shift = create(:shift, rota: rota, due_on: Date.new(2026, 7, 15))

    travel_to(Time.utc(2026, 7, 15, 8, 0)) do
      expect { described_class.perform_now }.not_to have_enqueued_job(SendSmsJob)
      expect(reminder_for(shift, 0)).to be_nil
    end
  end

  # Two houses, two clocks. At 08:30 UTC it is past 9am in London but not yet 9am in New York, so the
  # same day-of reminder is due for one group and not the other. Proof that each group's send hour is
  # read on its own zone rather than the server's.
  it "gives two groups in different timezones each their own send hour" do
    london = create(:rota, group: group, send_hour: 9, reminder_offsets: [ 0 ])
    london_shift = create(:shift, rota: london, due_on: Date.new(2026, 7, 15))

    ny_group = create(:group, timezone: "America/New_York")
    ny = create(:rota, group: ny_group, send_hour: 9, reminder_offsets: [ 0 ])
    ny_shift = create(:shift, rota: ny, due_on: Date.new(2026, 7, 15))

    travel_to(Time.utc(2026, 7, 15, 8, 30)) do # 09:30 BST in London, 04:30 EDT in New York
      described_class.perform_now

      expect(reminder_for(london_shift, 0)).to be_present
      expect(reminder_for(ny_shift, 0)).to be_nil
    end
  end

  # Every group's rota runs in one loop, so a single rota that raises must not starve the houses after
  # it — the same isolation TopUpShiftWindowsJob has, for the same reason.
  describe "when one rota's sweep blows up" do
    let(:boom) { RuntimeError.new("no") }
    let(:broken) { create(:rota, group: group, send_hour: 9, reminder_offsets: [ 0 ]) }
    let(:healthy) { create(:rota, group: create(:group), send_hour: 9, reminder_offsets: [ 0 ]) }
    let!(:broken_shift) { create(:shift, rota: broken, due_on: Date.new(2026, 7, 15)) }
    let!(:healthy_shift) { create(:shift, rota: healthy, due_on: Date.new(2026, 7, 15)) }

    before do
      exploding = instance_double(ReminderSweep)
      allow(exploding).to receive(:call).and_raise(boom)
      allow(ReminderSweep).to receive(:new).and_call_original
      allow(ReminderSweep).to receive(:new).with(having_attributes(id: broken.id)).and_return(exploding)
    end

    it "carries on with the others" do
      travel_to(Time.utc(2026, 7, 15, 8, 0)) do
        expect { described_class.perform_now }.not_to raise_error

        expect(reminder_for(healthy_shift, 0)).to be_present
        expect(reminder_for(broken_shift, 0)).to be_nil
      end
    end

    it "hands the failure to the error reporter" do
      allow(Rails.error).to receive(:report)

      travel_to(Time.utc(2026, 7, 15, 8, 0)) { described_class.perform_now }

      expect(Rails.error).to have_received(:report)
        .with(boom, hash_including(context: { rota_id: broken.id }))
    end

    # `Rails.error` has no subscribers in this app yet, so reporting alone would leave a job that
    # swallowed a house's reminders in silence and still finished green. Until a subscriber exists,
    # this log line is the only alarm, so it is worth a test of its own.
    it "says so in the log, loudly enough to find" do
      allow(Rails.logger).to receive(:error)

      travel_to(Time.utc(2026, 7, 15, 8, 0)) { described_class.perform_now }

      expect(Rails.logger).to have_received(:error).with(/rota #{broken.id}.*RuntimeError.*no/)
    end
  end

  # The sweep is only self-healing if it actually runs every hour. Guard the recurring entry so it
  # cannot be dropped without a spec turning red.
  describe "recurring schedule" do
    let(:config) { YAML.load_file(Rails.root.join("config/recurring.yml"), aliases: true) }

    it "is scheduled hourly in production" do
      entry = config.dig("production", "reminder_sweep")

      expect(entry).to include("class" => "ReminderSweepJob")
      expect(entry["schedule"]).to match(/every hour/)
    end
  end
end
