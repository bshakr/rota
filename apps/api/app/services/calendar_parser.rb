require "icalendar"
require "icalendar/recurrence"

# ICS text in, occurrences out. Every date the rest of the app sees is a civil date in the group's
# calendar, and every timed instant is a Time in the group's zone, so nothing downstream touches
# iCal's rules again: DTEND is exclusive, all-day values are dates not midnights, recurring events
# are many rows, and an override VEVENT (RECURRENCE-ID) replaces the instance it names.
#
# Both readers parse on first use, so `calendar_name` raises NotACalendar on a bad body just as
# `occurrences` does. A corrupt single event is survivable and is skipped with a warning; a body
# that cannot be parsed at all is not, and raises.
class CalendarParser
  class NotACalendar < StandardError; end

  Occurrence = Struct.new(:uid, :instance_key, :summary, :starts_on, :ends_on, :starts_at, :ends_at, :all_day, keyword_init: true)

  SUMMARY_LIMIT = 200
  UNTITLED = "(untitled)"

  # icalendar-recurrence reads the Date bounds of an expansion in the process's own zone rather than
  # the event's, so a host far enough east of the feed clips instances late on the window's last day.
  # Expanding two days wide covers the widest spread two zones can have, 26 hours from UTC+14 to
  # UTC-12, and everything the extra slack generates is dropped again by the window overlap below.
  EXPANSION_CUSHION = 2

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

      parse_calendar or raise NotACalendar, "empty calendar"
    end
  end

  # The body is remote input, so a malformed one must not reach the caller under a library error
  # class. Everything the parse step can fail on becomes the single error class the sync step knows
  # how to turn into a sentence for the admin.
  def parse_calendar
    Icalendar::Calendar.parse(@body).first
  rescue StandardError => e
    raise NotACalendar, "unparseable calendar: #{e.class}"
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
    # RFC 5545 pins a RECURRENCE-ID to the value type of DTSTART but not to its zone, so a UTC stamp
    # may legally name an instance of a TZID master. Matching on the rendered key would miss that,
    # leaving the house looking at the event twice and at a cancelled one that never went away, so
    # the match is on the zone-independent instant instead.
    override_by_instant = overrides.index_by { |event| value_instant(event.recurrence_id) }

    replaced = masters.flat_map { |master| expand(uid, master) }.map do |occurrence|
      override = override_by_instant.delete(occurrence_instant(occurrence))
      next occurrence if override.nil?

      # The winner keeps the master instance's rendered key, so a row's identity does not depend on
      # how the feed happened to stamp the override that replaced it.
      occurrence_from_event(uid, override, key: occurrence.instance_key)
    end
    # An override with no surviving master instance (the master's rule was edited, say) still counts.
    orphans = override_by_instant.each_value.map do |event|
      occurrence_from_event(uid, event, key: instance_key(uid, event.recurrence_id))
    end

    (replaced + orphans).compact
  rescue StandardError => e
    # One corrupt VEVENT must not sink the whole house calendar. The UID identifies it for support;
    # the title is somebody's private calendar entry and never goes into a log.
    Rails.logger.warn("CalendarParser skipped event #{uid}: #{e.class}")
    []
  end

  def expand(uid, event)
    return [] if cancelled?(event)
    return [ occurrence_from_event(uid, event, key: instance_key(uid, event.dtstart)) ] if event.rrule.blank?

    all_day = all_day?(event)
    event_zone = source_zone(event.dtstart)
    duration = duration_of(event)

    event.occurrences_between(from - EXPANSION_CUSHION, to + EXPANSION_CUSHION).map do |occurrence|
      # icalendar-recurrence hands every instance back as a plain UTC Time. A DATE-valued instance
      # was built as local midnight, so `getlocal` undoes exactly that before the civil date is
      # read: taking the UTC date instead puts every instance a day early anywhere east of
      # Greenwich. A timed instance is a true instant, so it goes into the event's own zone.
      start_value = all_day ? occurrence.start_time.getlocal.to_date : occurrence.start_time.in_time_zone(event_zone)
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

  # The identity of one instance as the rest of the app stores it: its UID plus its own start,
  # stamped in the event's own zone so the key does not move when a group's zone is corrected. Two
  # cases do fall back to the group's zone and so are not proof against that, an unknown TZID and a
  # floating value in a feed that declares no X-WR-TIMEZONE; both cost one churned sync at most.
  def instance_key(uid, value)
    "#{uid}##{instance_stamp(value)}"
  end

  # Matching an override to the instance it replaces uses this instead of the rendered key, because
  # the two sides may be stamped in different zones: the civil date for an all-day value, the
  # absolute instant for a timed one, neither of which depends on how it was written.
  def value_instant(value)
    value.is_a?(Icalendar::Values::Date) ? value.to_date : local_time(value).to_i
  end

  def occurrence_instant(occurrence)
    occurrence.all_day ? occurrence.starts_on : occurrence.starts_at.to_i
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
