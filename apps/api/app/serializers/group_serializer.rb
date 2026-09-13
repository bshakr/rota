# The tenant's own settings. `timezone_confirmed` is the load-bearing one: NULL `timezone_confirmed_at`
# means the system guessed UTC on JIT provisioning and no human has ever confirmed it, which is what
# the dashboard's warning hangs off. Exposing both the timestamp and the boolean lets the UI say
# "confirmed on <date>" as well as decide whether to nag.
class GroupSerializer < ApplicationSerializer
  def as_json
    {
      id: record.id,
      name: record.name,
      slug: record.slug,
      timezone: record.timezone,
      timezone_confirmed: record.timezone_confirmed?,
      timezone_confirmed_at: record.timezone_confirmed_at,
      # The house calendar link (BLO-1667), or null when no admin has connected one. The summary
      # never carries `ical_url`: the link is a credential and leaves the server only masked.
      calendar: CalendarConnectionSerializer.one(record.calendar_connection)
    }
  end
end
