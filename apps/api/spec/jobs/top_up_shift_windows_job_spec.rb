require "rails_helper"

RSpec.describe TopUpShiftWindowsJob do
  let(:group) { create(:group, timezone: "Europe/London") }

  around { |example| travel_to(Time.utc(2026, 7, 13, 3, 0)) { example.run } }

  it "enqueues on the default queue" do
    expect { described_class.perform_later }
      .to have_enqueued_job(described_class).on_queue("default")
  end

  it "fills an active rota's window out to 90 days" do
    rota = create(:rota, :with_roster, group: group, starts_on: Date.current,
      interval_count: 1, interval_unit: "week")

    described_class.perform_now

    expect(rota.shifts.maximum(:due_on)).to be_within(7).of(rota.group.today + 90.days)
  end

  it "leaves an inactive rota alone" do
    rota = create(:rota, :with_roster, :inactive, group: group, starts_on: Date.current)

    expect { described_class.perform_now }.not_to change(Shift, :count)
    expect(rota.shifts).to be_empty
  end

  it "skips a draft rota without complaining" do
    create(:rota, group: group, starts_on: Date.current)

    expect { described_class.perform_now }.not_to change(Shift, :count)
  end

  # The point of the daily run: yesterday's horizon is one day short of today's, so exactly one
  # shift falls into the window each day for a daily rota.
  it "tops the window back up as the horizon moves" do
    rota = create(:rota, :with_roster, group: group, starts_on: Date.current,
      interval_count: 1, interval_unit: "day")
    described_class.perform_now
    first_run = rota.shifts.maximum(:due_on)

    travel 1.day
    expect { described_class.perform_now }.to change(Shift, :count).by(1)
    expect(rota.shifts.maximum(:due_on)).to eq(first_run + 1.day)
  end

  it "adds nothing on a second run in the same day" do
    create(:rota, :with_roster, group: group, starts_on: Date.current)
    described_class.perform_now

    expect { described_class.perform_now }.not_to change(Shift, :count)
  end

  describe "when one rota blows up" do
    let(:broken) { create(:rota, :with_roster, group: group, starts_on: Date.current) }
    let(:healthy) { create(:rota, :with_roster, group: create(:group), starts_on: Date.current) }
    let(:boom) { RuntimeError.new("no") }

    before do
      broken
      healthy
      exploding = instance_double(ShiftGenerator)
      allow(exploding).to receive(:call).and_raise(boom)
      allow(ShiftGenerator).to receive(:new).and_call_original
      allow(ShiftGenerator).to receive(:new).with(having_attributes(id: broken.id)).and_return(exploding)
    end

    # Every group's rota is generated in the same loop. One group's bad data must not be able to
    # starve every group after it in the iteration order.
    it "carries on with the others" do
      expect { described_class.perform_now }.not_to raise_error

      expect(healthy.shifts).to be_present
      expect(broken.shifts).to be_empty
    end

    it "hands the failure to the error reporter" do
      allow(Rails.error).to receive(:report)

      described_class.perform_now

      expect(Rails.error).to have_received(:report)
        .with(boom, hash_including(context: { rota_id: broken.id }))
    end

    # The rescue must not be a black hole. `Rails.error` has no subscribers in this app yet, so
    # reporting alone would leave a job that swallowed every rota in silence and still finished
    # green — and the first anyone would know of it is a house that stopped being texted. Until a
    # subscriber exists, this log line IS the alarm, so it is worth a test of its own.
    it "says so in the log, loudly enough to find" do
      allow(Rails.logger).to receive(:error)

      described_class.perform_now

      expect(Rails.logger).to have_received(:error).with(/rota #{broken.id}.*RuntimeError.*no/)
    end
  end
end
