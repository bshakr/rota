require "icalendar"
require "icalendar/recurrence"

# ICS text in, occurrences out. Every date the rest of the app sees is a civil date in the group's
# calendar, and every timed instant is a Time in the group's zone, so nothing downstream touches
# iCal's rules again: DTEND is exclusive, all-day values are dates not midnights, recurring events
# are many rows, and an override VEVENT (RECURRENCE-ID) replaces the instance it names.
class CalendarParser
  class NotACalendar < StandardError; end

  Occurrence = Struct.new(:uid, :instance_key, :summary, :starts_on, :ends_on, :starts_at, :ends_at, :all_day, keyword_init: true)

  SUMMARY_LIMIT = 200
  UNTITLED = "(untitled)"

  def initialize(body, zone:, from:, to:)
    @body = body.to_s
    @zone = zone
    @from = from
    @to = to
  end

  def calendar_name
    feed_property("X-WR-CALNAME").presence
  end

  def occurrences
    @occurrences ||= build_occurrences
  end

  private

  attr_reader :zone, :from, :to

  def calendar
    @calendar ||= begin
      raise NotACalendar, "no VCALENDAR" unless @body.include?("BEGIN:VCALENDAR")

      Icalendar::Calendar.parse(@body).first or raise NotACalendar, "empty calendar"
    end
  end

  # icalendar files every unrecognised property under a downcased, underscored key, so the
  # X- properties we read are looked up as "x_wr_calname" and "x_wr_timezone".
  def feed_property(name)
    calendar.custom_property(name.tr("-", "_")).first.to_s.strip
  end

  # Floating times (no TZID, no Z) are read in the feed's own zone when it declares one.
  def feed_zone
    @feed_zone ||= ActiveSupport::TimeZone[feed_property("X-WR-TIMEZONE")] || zone
  end

  def build_occurrences
    calendar.events
            .group_by { |event| event.uid.to_s }
            .flat_map { |uid, events| occurrences_for(uid, events) }
            .select { |occurrence| occurrence.ends_on >= from && occurrence.starts_on <= to }
  end

  def occurrences_for(uid, events)
    masters, overrides = events.partition { |event| event.recurrence_id.nil? }
    override_by_key = overrides.to_h { |event| [ instance_key(uid, event.recurrence_id), event ] }

    instances = masters.flat_map { |master| expand(uid, master) }
    instances = instances.map { |occurrence| override_by_key.delete(occurrence.instance_key) || occurrence }
    # An override with no surviving master instance (the master's rule was edited, say) still counts.
    instances += override_by_key.values
    instances.filter_map do |instance|
      next instance if instance.is_a?(Occurrence)

      occurrence_from_event(uid, instance, key: instance_key(uid, instance.recurrence_id))
    end
  end

  def expand(uid, event)
    return [] if cancelled?(event)
    return [ occurrence_from_event(uid, event, key: instance_key(uid, event.dtstart)) ] if event.rrule.blank?

    all_day = all_day?(event)
    event_zone = source_zone(event.dtstart)
    duration = duration_of(event)

    event.occurrences_between(from - 1, to + 1).map do |occurrence|
      # icalendar-recurrence hands every instance back as a plain UTC Time, so each one is put
      # back into the event's own zone before it is stamped into a key.
      start_value = all_day ? occurrence.start_time.to_date : occurrence.start_time.in_time_zone(event_zone)
      build(uid: uid, key: instance_key(uid, start_value), summary: event.summary,
            start_value: start_value, end_value: start_value + duration, all_day: all_day)
    end
  end

  def occurrence_from_event(uid, event, key:)
    return nil if cancelled?(event)

    all_day = all_day?(event)
    start_value = all_day ? event.dtstart.to_date : local_time(event.dtstart)
    end_value =
      if event.dtend.nil?
        all_day ? start_value + 1 : start_value
      elsif all_day
        event.dtend.to_date
      else
        local_time(event.dtend)
      end

    build(uid: uid, key: key, summary: event.summary, start_value: start_value, end_value: end_value, all_day: all_day)
  end

  # start/end values are Dates for all-day events (end exclusive, per iCal) or Times otherwise.
  def build(uid:, key:, summary:, start_value:, end_value:, all_day:)
    if all_day
      Occurrence.new(uid: uid, instance_key: key, summary: title(summary), all_day: true,
                     starts_on: start_value, ends_on: [ end_value - 1, start_value ].max, starts_at: nil, ends_at: nil)
    else
      starts_at = start_value.in_time_zone(zone)
      ends_at = end_value.in_time_zone(zone)
      # An instant ending exactly at midnight belongs to the day that just closed, not the new one.
      ends_on = ends_at.to_date
      ends_on -= 1 if ends_at > starts_at && ends_at == ends_at.beginning_of_day
      Occurrence.new(uid: uid, instance_key: key, summary: title(summary), all_day: false,
                     starts_on: starts_at.to_date, ends_on: [ ends_on, starts_at.to_date ].max, starts_at: starts_at, ends_at: ends_at)
    end
  end

  def duration_of(event)
    if all_day?(event)
      event.dtend ? (event.dtend.to_date - event.dtstart.to_date).to_i : 1
    else
      event.dtend ? local_time(event.dtend) - local_time(event.dtstart) : 0
    end
  end

  def all_day?(event)
    event.dtstart.is_a?(Icalendar::Values::Date)
  end

  # A value with a TZID is read in that zone; `Z` values arrive carrying tzid "UTC"; a value with
  # neither is floating and read in the feed's declared zone.
  def source_zone(value)
    tzid = Array(value.ical_params["tzid"]).first.to_s
    tzid.present? ? (ActiveSupport::TimeZone[tzid] || zone) : feed_zone
  end

  # Reading the components ourselves sidesteps the library's own conversion, which is where DST
  # mistakes creep in.
  def local_time(value)
    source_zone(value).local(value.year, value.month, value.day, value.hour, value.min, value.sec)
  end

  # The identity of one instance: its UID plus its own start, stamped in the event's own zone so
  # that a RECURRENCE-ID override lines up with the master instance it replaces no matter which
  # group is reading the feed.
  def instance_key(uid, value)
    "#{uid}##{instance_stamp(value)}"
  end

  def instance_stamp(value)
    case value
    when Icalendar::Values::Date then value.to_date.iso8601
    when Icalendar::Values::DateTime then local_time(value).iso8601
    else value.iso8601
    end
  end

  def cancelled?(event)
    event.status.to_s.casecmp?("CANCELLED")
  end

  def title(summary)
    summary.to_s.strip.presence&.first(SUMMARY_LIMIT) || UNTITLED
  end
end
