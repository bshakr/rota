# The admin's view of the house calendar link. The link itself is never here, since `masked_url` is
# enough to recognise it, and `failing` is the one flag the dashboard warning hangs off.
class CalendarConnectionSerializer < ApplicationSerializer
  def as_json
    {
      calendar_name: record.calendar_name,
      masked_url: record.masked_url,
      events_count: record.events_count,
      # Spec 7.4: how many titles the model has not answered for yet, so the card can say so and
      # the admin knows the list is still filling in rather than wrong.
      unclassified_count: record.unclassified_count,
      last_synced_at: record.last_synced_at,
      last_error: record.last_error,
      failing: record.failing?
    }
  end
end
