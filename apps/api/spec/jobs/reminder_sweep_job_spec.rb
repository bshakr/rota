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

  # A house an operator has paused (BLO-1675). The skip is INSIDE the loop, not around it, so the
  # JobRun wrapper still writes a row — "the sweep ran and there was nothing to do" and "the sweep
  # stopped running" are the two things the operator's system health tile exists to tell apart.
  describe "a suspended house" do
    let!(:rota) { create(:rota, group: group, send_hour: 9, reminder_offsets: [ 0 ]) }
    let!(:shift) { create(:shift, rota: rota, due_on: Date.new(2026, 7, 15)) }

    before { group.update!(suspended_at: 1.day.ago) }

    it "is not texted, and not even claimed" do
      travel_to(Time.utc(2026, 7, 15, 8, 0)) do
        expect { described_class.perform_now }.not_to have_enqueued_job(SendSmsJob)
      end

      expect(reminder_for(shift, 0)).to be_nil
    end

    it "does not stop the sweep from running, or from writing down that it ran" do
      live = create(:rota, group: create(:group, timezone: "Europe/London"), send_hour: 9, reminder_offsets: [ 0 ])
      live_shift = create(:shift, rota: live, due_on: Date.new(2026, 7, 15))

      travel_to(Time.utc(2026, 7, 15, 8, 0)) { described_class.perform_now }

      expect(reminder_for(live_shift, 0)).to be_present
      expect(JobRun.sole).to have_attributes(name: "reminder_sweep", succeeded: true)
    end

    # The reason suspension is safe to reach for: because no reminder was ever CLAIMED while the
    # house was paused, resuming cannot fire a backlog. ReminderSweep's 24-hour staleness guard
    # buries every send moment that passed in the meantime, exactly as it does after an outage — so
    # a house paused for a couple of days does not text everybody about two days of chores the
    # moment it comes back.
    #
    # A MULTI-DAY offset on purpose. A day-of reminder is retired at the group's midnight by the
    # candidate window rather than by staleness, so it would pass this test for the wrong reason;
    # offset 2 leaves the shift squarely inside the window on the day of the resume, which makes the
    # 24-hour guard the only thing standing between it and a text.
    it "fires no backlog when it is resumed two days later" do
      advance = create(:rota, group: group, send_hour: 9, reminder_offsets: [ 2 ])
      # Its "2 days to go" moment is 09:00 BST on 16 July — while the house is paused.
      missed = create(:shift, rota: advance, due_on: Date.new(2026, 7, 18))
      # And this one's is 09:00 BST on 18 July: the very moment the house comes back.
      due_now = create(:shift, rota: advance, due_on: Date.new(2026, 7, 20))

      travel_to(Time.utc(2026, 7, 16, 8, 0)) { described_class.perform_now }
      expect(reminder_for(missed, 2)).to be_nil

      travel_to(Time.utc(2026, 7, 18, 8, 0)) do
        group.update!(suspended_at: nil)
        described_class.perform_now
      end

      # Still inside the candidate window — the shift has not even come due yet — so staleness, and
      # nothing else, is what keeps its 48-hour-overdue reminder buried.
      expect(missed.due_on).to be >= Date.new(2026, 7, 18)
      expect(reminder_for(missed, 2)).to be_nil
      # Not a backlog: its moment is now, and the house is live again.
      expect(reminder_for(due_now, 2)).to be_present
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

    # `report` now reaches Sentry (sentry-rails subscribes to `Rails.error`, see
    # config/initializers/sentry.rb), and the log line stays anyway: it is what a human reads beside
    # everything else this process did, and it is still the whole alarm in development and test,
    # where the reporter is disabled. Worth a test of its own for as long as that is true.
    it "says so in the log, loudly enough to find" do
      allow(Rails.logger).to receive(:error)

      travel_to(Time.utc(2026, 7, 15, 8, 0)) { described_class.perform_now }

      expect(Rails.logger).to have_received(:error).with(/rota #{broken.id}.*RuntimeError.*no/)
    end
  end

  # The heartbeat the operator dashboard reads (BLO-1677). Solid Queue's own record of this run is
  # deleted hourly by `clear_solid_queue_finished_jobs`, so this row is the only lasting evidence
  # that the sweep ran at all.
  describe "the run it writes down" do
    it "records a finished run" do
      travel_to(Time.utc(2026, 7, 15, 8, 0)) { described_class.perform_now }

      expect(JobRun.sole).to have_attributes(
        name: "reminder_sweep", succeeded: true, error_class: nil
      )
    end

    # A per-rota failure is rescued inside the loop and never reaches here. This is the sweep itself
    # falling over, which must be written down AND still fail the job.
    it "records the failure and still raises when the sweep itself falls over" do
      allow(Rota).to receive(:active).and_raise(ActiveRecord::StatementInvalid, "connection lost")

      expect { described_class.perform_now }.to raise_error(ActiveRecord::StatementInvalid)

      expect(JobRun.sole).to have_attributes(
        name: "reminder_sweep", succeeded: false, error_class: "ActiveRecord::StatementInvalid"
      )
    end

    it "still counts as a successful run when one rota was rescued inside the loop" do
      allow(Rails.logger).to receive(:error)
      allow(Rails.error).to receive(:report)
      allow(ReminderSweep).to receive(:new).and_raise(RuntimeError, "no")
      create(:rota, group: group, send_hour: 9, reminder_offsets: [ 0 ])

      travel_to(Time.utc(2026, 7, 15, 8, 0)) { described_class.perform_now }

      expect(JobRun.sole).to have_attributes(name: "reminder_sweep", succeeded: true)
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

  # A rename here silently orphans the Sentry monitor: the old slug stops checking in and starts
  # alerting, and the new one quietly creates a second monitor nobody is watching. Cheap to assert.
  describe "the cron monitor" do
    it "checks in under the slug the monitor was created with" do
      expect(described_class.sentry_monitor_slug).to eq("reminder-sweep")
    end

    it "declares the hourly schedule a missed check-in is measured against" do
      expect(described_class.sentry_monitor_config.to_h).to include(
        schedule: { type: :interval, value: 1, unit: :hour },
        checkin_margin: 15,
        timezone: "UTC"
      )
    end
  end
end
