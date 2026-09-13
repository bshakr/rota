# One occurrence as both the admin preview and the member feed see it: title, civil dates, a
# wall-clock start for timed entries, the kind, and who it says is away. Description, location and
# attendees were never read out of the feed, so they cannot leak here.
class CalendarEventSerializer < ApplicationSerializer
  def as_json
    {
      id: record.id,
      title: record.summary,
      starts_on: record.starts_on.iso8601,
      ends_on: record.ends_on.iso8601,
      all_day: record.all_day,
      # The time the house wrote down, not the time the database stored. An all-day entry has no
      # clock at all, which is what `null` says.
      start_time: record.all_day ? nil : record.starts_at.in_time_zone(group.time_zone).strftime("%H:%M"),
      kind: record.kind,
      member_ids: record.calendar_event_members.map(&:member_id).sort
    }
  end

  private

  def group = record.calendar_connection.group
end
