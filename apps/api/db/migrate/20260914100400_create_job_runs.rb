# One row per pass of a recurring job, so the operator dashboard can say when each of them last
# finished. Rows are pruned after ninety days by the `prune_job_runs` entry in
# config/recurring.yml — the same housekeeping `clear_solid_queue_finished_jobs` does next to it
# for Solid Queue's own tables. See JobRun.
class CreateJobRuns < ActiveRecord::Migration[8.1]
  def change
    create_table :job_runs do |t|
      # The recurring job's own name, matching the key it is scheduled under in
      # config/recurring.yml wherever the two can agree. Deliberately a plain string with no check
      # constraint: the next job to start reporting is a new string, not a migration.
      t.string :name, null: false
      t.datetime :started_at, null: false
      t.datetime :finished_at, null: false
      # A run that raised is still a run, and a job that has been failing every hour for a day is
      # exactly what the system health tile exists to surface. `error_class` names what went wrong;
      # the message and backtrace stay in the log, because this table is a heartbeat and not a
      # second error tracker.
      t.boolean :succeeded, null: false
      t.string :error_class
      # Optional, free-shape counters a job can fill in as it runs (JobRun.record yields a hash for
      # it). Nothing writes it today; it is here so that "the sweep ran, and here is what it did"
      # does not need a migration the first time a job has something worth counting.
      t.jsonb :details

      # The one question the overview asks: "when did <name> last finish?". Leading on name and
      # ordering by finished_at answers it from the index alone.
      t.index %i[name finished_at]

      # No updated_at. A run is a fact about one pass at one instant — it is written once, when the
      # pass ends, and there is nothing about it to change afterwards.
      t.datetime :created_at, null: false
    end
  end
end
