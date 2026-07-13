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
    # Every group's rota is generated in the same loop. One group's bad data must not be able to
    # starve every group after it in the iteration order — the failure is reported, and the rest
    # of the houses still get their shifts.
    it "reports it and carries on with the others" do
      broken = create(:rota, :with_roster, group: group, starts_on: Date.current)
      healthy = create(:rota, :with_roster, group: create(:group), starts_on: Date.current)
      boom = RuntimeError.new("no")

      allow(ShiftGenerator).to receive(:new).and_call_original
      allow(ShiftGenerator).to receive(:new).with(having_attributes(id: broken.id))
        .and_return(instance_double(ShiftGenerator).tap { |d| allow(d).to receive(:call).and_raise(boom) })
      allow(Rails.error).to receive(:report)

      expect { described_class.perform_now }.not_to raise_error

      expect(Rails.error).to have_received(:report).with(boom, hash_including(context: { rota_id: broken.id }))
      expect(healthy.shifts).to be_present
      expect(broken.shifts).to be_empty
    end
  end
end
