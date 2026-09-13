# A heartbeat: one row per pass of a recurring job, written when the pass ends.
#
# This table exists because Solid Queue deletes its own evidence. `clear_solid_queue_finished_jobs`
# in config/recurring.yml runs `SolidQueue::Job.clear_finished_in_batches` every hour at minute 12,
# so "when did the reminder sweep last run?" is unanswerable from Solid Queue's tables for anything
# older than the last cleanup — and the sweep running hourly means the interesting case, "it stopped
# running some time yesterday", is precisely the one the cleanup has already erased.
#
# A failed run is recorded too, and the exception is re-raised afterwards so the job still fails the
# way it would have. A job that raises every hour and a job that stopped being scheduled look
# identical from the outside if only successes are written down; they are very different problems.
class JobRun < ApplicationRecord
  # The names the overview's system health tile looks for. Each one is EXACTLY its
  # config/recurring.yml key, so "which job is this row?" is answered by reading the schedule file
  # and nothing has to be translated in between.
  REMINDER_SWEEP = "reminder_sweep".freeze
  TOP_UP_SHIFT_WINDOWS = "top_up_shift_windows".freeze
  SYNC_HOUSE_CALENDARS = "sync_house_calendars".freeze

  # In the order the health tile reads them. A name with no rows yet still appears, reported as
  # "never finished" — a job that has never run once is the loudest thing this tile can say, and it
  # would be invisible if the list were built from the rows that happen to exist.
  MONITORED = [ REMINDER_SWEEP, TOP_UP_SHIFT_WINDOWS, SYNC_HOUSE_CALENDARS ].freeze

  # How long a run is worth keeping. Long enough to answer "when did this start failing?" across a
  # quarter, short enough that the table never becomes a thing anyone has to think about.
  RETENTION = 90.days

  validates :name, presence: true
  validates :started_at, :finished_at, presence: true

  # Runs the block, then records that it ran. Returns whatever the block returned, and re-raises
  # whatever it raised, so wrapping a job in this changes nothing about what the job does.
  #
  # The block may take one argument, a mutable Hash, and put anything JSON-shaped in it; it is
  # stored in `details` (left NULL when nothing was added, so an empty hash never masquerades as a
  # recorded fact).
  #
  #   JobRun.record(JobRun::REMINDER_SWEEP) { sweep_every_rota }
  #   JobRun.record(JobRun::SYNC_HOUSE_CALENDARS) { |details| details[:connections] = sync_all }
  def self.record(name)
    started_at = Time.current
    details = {}
    failure = nil

    result =
      begin
        yield(details)
      rescue StandardError => e
        failure = e
        nil
      end

    write(
      name: name,
      started_at: started_at,
      finished_at: Time.current,
      succeeded: failure.nil?,
      error_class: failure&.class&.name,
      details: details.presence
    )

    raise failure if failure

    result
  end

  # The heartbeat must never be the thing that breaks the job it is measuring. A full disk, a
  # migration mid-deploy, a queue database that has gone away — none of those are reasons for the
  # reminder sweep to stop texting people, and swapping a working sweep for a broken one because
  # its bookkeeping failed would be the worst possible trade.
  #
  # Log as well as report: `Rails.error` has no subscribers in this app yet, so `report` alone is a
  # no-op, and a heartbeat that silently stopped beating would read on the dashboard exactly like a
  # job that stopped running. The log line is what tells the two apart today.
  def self.write(**attributes)
    create!(**attributes)
  rescue StandardError => e
    Rails.logger.error("JobRun could not record #{attributes[:name]}: #{e.class}: #{e.message}")
    Rails.error.report(e, context: { job_run_name: attributes[:name] }, source: "rotamonster.job_run")
    nil
  end
  private_class_method :write

  # Deletes runs older than the retention window, and answers how many it removed. Scheduled daily
  # as `prune_job_runs` in config/recurring.yml, for exactly the reason
  # `clear_solid_queue_finished_jobs` sits beside it there: three jobs writing a row per pass is
  # about fifty rows a day, and a table nothing ever deletes from is one that eventually needs an
  # outage to fix.
  #
  # `delete_all`, not `destroy_all`: there are no callbacks and nothing cascades off a job run, so
  # instantiating a quarter's worth of rows one at a time would buy nothing.
  def self.prune!(older_than: RETENTION)
    where(finished_at: ...older_than.ago).delete_all
  end

  # The most recent finished run of each of the given names, as a Hash keyed by name. DISTINCT ON is
  # Postgres', which this app is on everywhere, and it reads straight down the (name, finished_at)
  # index instead of pulling every historic run back to sort in Ruby.
  def self.latest_by_name(names = MONITORED)
    where(name: names)
      .select("DISTINCT ON (name) *")
      .order(:name, finished_at: :desc, id: :desc)
      .index_by(&:name)
  end
end
