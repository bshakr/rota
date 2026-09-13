require "rails_helper"

RSpec.describe JobRun do
  describe ".record" do
    it "writes a successful run around the block and hands back what it returned" do
      travel_to Time.utc(2026, 9, 14, 3, 0, 0) do
        result = described_class.record(described_class::TOP_UP_SHIFT_WINDOWS) { :topped_up }

        expect(result).to eq(:topped_up)

        run = described_class.sole
        expect(run).to have_attributes(
          name: "top_up_shift_windows",
          succeeded: true,
          error_class: nil,
          details: nil
        )
        expect(run.started_at).to eq(Time.utc(2026, 9, 14, 3, 0, 0))
        expect(run.finished_at).to eq(Time.utc(2026, 9, 14, 3, 0, 0))
      end
    end

    it "times the block rather than the moment it was called" do
      started = Time.utc(2026, 9, 14, 3, 0, 0)

      travel_to(started) do
        described_class.record(described_class::REMINDER_SWEEP) { travel 90.seconds }
      end

      run = described_class.sole
      expect(run.started_at).to eq(started)
      expect(run.finished_at).to eq(started + 90.seconds)
    end

    it "records the failure and re-raises, so the job still fails" do
      expect {
        described_class.record(described_class::SYNC_HOUSE_CALENDARS) { raise ArgumentError, "no feed" }
      }.to raise_error(ArgumentError, "no feed")

      expect(described_class.sole).to have_attributes(
        name: "sync_house_calendars",
        succeeded: false,
        error_class: "ArgumentError"
      )
    end

    it "stores whatever the block put in the details hash" do
      described_class.record(described_class::SYNC_HOUSE_CALENDARS) { |details| details[:connections] = 4 }

      expect(described_class.sole.details).to eq("connections" => 4)
    end

    it "leaves details NULL when the block added nothing, so an empty hash is never a recorded fact" do
      described_class.record(described_class::SYNC_HOUSE_CALENDARS) { :done }

      expect(described_class.sole.details).to be_nil
    end

    # The heartbeat must never be the thing that breaks the job it is measuring.
    it "swallows its own write failure and still returns the block's value" do
      allow(described_class).to receive(:create!).and_raise(ActiveRecord::StatementInvalid, "disk full")
      allow(Rails.logger).to receive(:error)
      allow(Rails.error).to receive(:report)

      expect(described_class.record(described_class::REMINDER_SWEEP) { :swept }).to eq(:swept)

      expect(described_class.count).to eq(0)
      expect(Rails.logger).to have_received(:error).with(/JobRun could not record reminder_sweep/)
      # The log line is today's alarm; the report is what carries it to Sentry the day a subscriber
      # exists. Both, or a heartbeat that stopped beating reads exactly like a job that stopped.
      expect(Rails.error).to have_received(:report).with(
        instance_of(ActiveRecord::StatementInvalid),
        hash_including(context: { job_run_name: "reminder_sweep" })
      )
    end

    it "still re-raises the block's failure when its own write also fails" do
      allow(described_class).to receive(:create!).and_raise(ActiveRecord::StatementInvalid, "disk full")
      allow(Rails.logger).to receive(:error)

      expect {
        described_class.record(described_class::REMINDER_SWEEP) { raise ArgumentError, "bad rota" }
      }.to raise_error(ArgumentError, "bad rota")
    end
  end

  describe ".prune!" do
    it "deletes runs past the retention window and keeps the rest" do
      old = create(:job_run, finished_at: 91.days.ago)
      boundary = create(:job_run, finished_at: 89.days.ago)
      recent = create(:job_run, finished_at: 1.hour.ago)

      expect(described_class.prune!).to eq(1)

      expect(described_class.pluck(:id)).to contain_exactly(boundary.id, recent.id)
      expect { old.reload }.to raise_error(ActiveRecord::RecordNotFound)
    end

    it "takes a window of its own" do
      create(:job_run, finished_at: 3.days.ago)
      create(:job_run, finished_at: 1.hour.ago)

      expect(described_class.prune!(older_than: 2.days)).to eq(1)
      expect(described_class.count).to eq(1)
    end

    it "does nothing, loudly enough, when there is nothing to prune" do
      create(:job_run, finished_at: 1.hour.ago)

      expect(described_class.prune!).to eq(0)
      expect(described_class.count).to eq(1)
    end
  end

  # The table only stays small if the prune actually runs. Guard the recurring entry so it cannot be
  # dropped without a spec turning red — the same guard the three jobs have on their own schedules.
  describe "recurring schedule" do
    let(:config) { YAML.load_file(Rails.root.join("config/recurring.yml"), aliases: true) }

    it "is pruned daily in production" do
      entry = config.dig("production", "prune_job_runs")

      expect(entry).to include("command" => "JobRun.prune!")
      expect(entry["schedule"]).to match(/every day/)
    end

    # Every monitored name is exactly a key in the schedule file, so a row on the health tile can be
    # traced to the job that writes it without translating anything in between.
    it "names every monitored job exactly as recurring.yml schedules it" do
      expect(config["production"].keys).to include(*described_class::MONITORED)
    end
  end

  describe ".latest_by_name" do
    it "returns the most recent finished run per name and nothing for a name that never ran" do
      create(:job_run, name: JobRun::REMINDER_SWEEP, finished_at: 3.hours.ago)
      newest = create(:job_run, name: JobRun::REMINDER_SWEEP, finished_at: 1.hour.ago)
      top_up = create(:job_run, name: JobRun::TOP_UP_SHIFT_WINDOWS, finished_at: 2.hours.ago)

      latest = described_class.latest_by_name

      expect(latest.keys).to contain_exactly("reminder_sweep", "top_up_shift_windows")
      expect(latest["reminder_sweep"].id).to eq(newest.id)
      expect(latest["top_up_shift_windows"].id).to eq(top_up.id)
    end

    it "ignores names it was not asked about" do
      create(:job_run, name: "something_else", finished_at: 1.minute.ago)

      expect(described_class.latest_by_name).to be_empty
    end
  end
end
