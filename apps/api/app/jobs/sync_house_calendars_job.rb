# Hourly refresh of every connected house calendar. Runs on the clock; see config/recurring.yml.
#
# Idempotent, and for the same reason TopUpShiftWindowsJob is: CalendarSync upserts by instance key
# and prunes whatever left the feed, so it reconciles the house's events to what the feed says right
# now rather than continuing from wherever the last run stopped. A doubled run costs a second fetch
# and a no-op upsert; a missed run costs nothing at all, because the next hour recomputes the lot.
#
# Only enabled connections are touched. A link Google has reset is disabled by CalendarSync after
# three tries, and a disabled connection stays out of this loop until an admin pastes a new one.
class SyncHouseCalendarsJob < ApplicationJob
  queue_as :default

  # Wrapped in a JobRun so the operator dashboard can answer "when did the calendar sync last
  # finish?". Solid Queue's own record of the run is deleted hourly by
  # `clear_solid_queue_finished_jobs`, and this job is a no-op until a house connects a calendar —
  # which means "it has not run in days" and "nobody has connected one" look the same on the
  # dashboard unless the run itself is written down. See JobRun.
  def perform
    JobRun.record(JobRun::SYNC_HOUSE_CALENDARS) { sync_every_enabled_connection }
  end

  private

  def sync_every_enabled_connection
    CalendarConnection.enabled.includes(:group).find_each do |connection|
      CalendarSync.new(connection).call
    rescue StandardError => e
      # Every house's calendar is synced in this one loop, so a single connection that raises must
      # not be allowed to starve every house after it in the iteration order. Note that the ordinary
      # failures never arrive here at all. An unreachable feed, a reset link and a body that is not
      # a calendar are all recorded on the connection by CalendarSync, for the admin to read. What
      # this rescue catches is the unforeseen, and the answer to the unforeseen is the one
      # TopUpShiftWindowsJob gives: report it and carry on, because the next hourly run picks the
      # connection up again.
      #
      # Log it as well as report it, and do not be tempted to drop the log line as duplication.
      # `Rails.error` has no subscribers in this app yet, so `report` on its own is a genuine no-op,
      # and a rescue that swallowed every connection in silence and still finished GREEN would turn
      # "sync is broken for everyone" into a bug whose first symptom is a house whose calendar
      # quietly stopped updating. The log line is the only thing that makes this visible today;
      # `report` is what will carry it to Sentry the day a subscriber is added.
      #
      # The connection's id is printed, never its ical_url: the link is a credential, and the one
      # rule this file must not break is that it stays out of the logs. The id is the only thing
      # this line adds to the exception's own message, so keep it that way.
      Rails.logger.error("SyncHouseCalendarsJob failed for connection #{connection.id}: #{e.class}: #{e.message}")
      Rails.error.report(e, context: { calendar_connection_id: connection.id }, source: "rotamonster.calendar_sync")
    end
  end
end
