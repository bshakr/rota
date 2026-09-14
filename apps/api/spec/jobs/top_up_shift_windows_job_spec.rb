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

  # Assertions here are scoped to the rota under test, never to a global Shift.count. `bin/setup`
  # seeds a demo group into the test database, and those seeded rotas are committed baseline that
  # this job legitimately generates shifts for on every run — a global count would make these
  # specs pass or fail on whether the world happened to be seeded.
  it "leaves an inactive rota alone" do
    rota = create(:rota, :with_roster, :inactive, group: group, starts_on: Date.current)

    described_class.perform_now

    expect(rota.shifts).to be_empty
  end

  it "skips a draft rota without complaining" do
    rota = create(:rota, group: group, starts_on: Date.current)

    expect { described_class.perform_now }.not_to raise_error
    expect(rota.shifts).to be_empty
  end

  # The point of the daily run: yesterday's horizon is one day short of today's, so exactly one
  # shift falls into this rota's window each day for a daily rota.
  it "tops the window back up as the horizon moves" do
    rota = create(:rota, :with_roster, group: group, starts_on: Date.current,
      interval_count: 1, interval_unit: "day")
    described_class.perform_now
    first_run = rota.shifts.maximum(:due_on)

    travel 1.day
    expect { described_class.perform_now }.to change { rota.shifts.count }.by(1)
    expect(rota.shifts.maximum(:due_on)).to eq(first_run + 1.day)
  end

  it "adds nothing to a rota already topped up in the same day" do
    rota = create(:rota, :with_roster, group: group, starts_on: Date.current)
    described_class.perform_now

    expect { described_class.perform_now }.not_to change { rota.shifts.count }
  end

  # A house an operator has paused (BLO-1675). Its window simply stops being topped up: nothing is
  # deleted, the shifts it already has stay exactly where they are, and the next daily run after a
  # resume fills it back to ninety days in one pass — because this job asks only whether the window
  # is full now.
  describe "a suspended house" do
    let(:paused) { create(:group, timezone: "Europe/London", suspended_at: 1.day.ago) }

    it "is left out of the top-up" do
      rota = create(:rota, :with_roster, group: paused, starts_on: Date.current)

      described_class.perform_now

      expect(rota.shifts).to be_empty
    end

    it "keeps the shifts it already had" do
      rota = create(:rota, :with_roster, group: paused, starts_on: Date.current)
      existing = create(:shift, rota: rota, assigned_member: rota.members.first, due_on: Date.current + 3)

      described_class.perform_now

      expect(rota.shifts.pluck(:id)).to eq([ existing.id ])
    end

    # The skip is inside the loop, not around it, so the JobRun wrapper still writes a row: "the
    # top-up ran and had nothing to do" and "the top-up stopped running" are the two things the
    # operator's system health tile exists to tell apart.
    it "does not stop the job running, or writing down that it ran" do
      paused_rota = create(:rota, :with_roster, group: paused, starts_on: Date.current)
      live = create(:rota, :with_roster, group: group, starts_on: Date.current)

      described_class.perform_now

      expect(paused_rota.shifts).to be_empty
      expect(live.shifts).to be_present
      expect(JobRun.sole).to have_attributes(name: "top_up_shift_windows", succeeded: true)
    end

    it "fills the window back up on the first run after a resume" do
      rota = create(:rota, :with_roster, group: paused, starts_on: Date.current,
        interval_count: 1, interval_unit: "week")
      described_class.perform_now

      paused.update!(suspended_at: nil)
      described_class.perform_now

      expect(rota.shifts.maximum(:due_on)).to be_within(7).of(rota.group.today + 90.days)
    end
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

  # The heartbeat the operator dashboard reads (BLO-1677). Solid Queue's own record of this run is
  # deleted hourly by `clear_solid_queue_finished_jobs`, and this job runs only once a day, so
  # without this row "it last ran at 3am" is unanswerable by the time anyone asks.
  describe "the run it writes down" do
    it "records a finished run" do
      described_class.perform_now

      expect(JobRun.sole).to have_attributes(
        name: "top_up_shift_windows", succeeded: true, error_class: nil
      )
    end

    # A per-rota failure is rescued inside the loop and never reaches here. This is the top-up
    # itself falling over, which must be written down AND still fail the job.
    it "records the failure and still raises when the top-up itself falls over" do
      allow(Rota).to receive(:active).and_raise(ActiveRecord::StatementInvalid, "connection lost")

      expect { described_class.perform_now }.to raise_error(ActiveRecord::StatementInvalid)

      expect(JobRun.sole).to have_attributes(
        name: "top_up_shift_windows", succeeded: false, error_class: "ActiveRecord::StatementInvalid"
      )
    end
  end
end
