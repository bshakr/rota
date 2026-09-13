# The admin pasted a link. Prove it works before storing it: fetch and parse once, and only then
# replace whatever connection the house had. A bad link is an Invalid carrying the sentence the form
# shows; nothing is written.
class CalendarConnect
  class Invalid < StandardError
    attr_reader :code

    def initialize(code, message)
      @code = code
      super(message)
    end
  end

  # Spec section 4. The admin cannot act on the difference between a timeout, a 404 and a body that
  # was too big: in all three cases the link did not produce a calendar, and the thing to do is
  # check it is the secret iCal address rather than the one from the browser's address bar. So the
  # codes stay distinct for the API and the log, and the sentence is one.
  FETCH_FAILED = "Couldn't fetch that link. Check it is the secret iCal address and try again."

  MESSAGES = {
    CalendarFetch::InvalidUrl => "Paste the full https link.",
    CalendarParser::NotACalendar => "That link isn't a calendar feed."
  }.freeze

  CODES = {
    CalendarFetch::InvalidUrl => "not_https",
    CalendarFetch::Unreachable => "unreachable",
    CalendarFetch::TooLarge => "too_large",
    CalendarFetch::Gone => "gone",
    CalendarParser::NotACalendar => "not_a_calendar"
  }.freeze

  def self.call(group:, url:)
    # CalendarFetch is the one place that decides what a usable link is (https, a host, parseable),
    # so the shape is not re-litigated here. Stripping is ours, though: what is stored is what the
    # admin pasted, and a copy out of Google's settings dialog carries whitespace.
    url = url.to_s.strip
    result = CalendarFetch.call(url)
    from, to = CalendarSync.window_for(group)
    CalendarParser.new(result.body, zone: group.time_zone, from: from, to: to).occurrences

    connection = CalendarConnection.transaction do
      group.calendar_connection&.destroy!
      group.create_calendar_connection!(ical_url: url)
    end
    # The body is already in hand, so the first sync re-reads it rather than asking Google again.
    CalendarSync.new(connection).call(fetched: result)
  rescue CalendarFetch::Error, CalendarParser::NotACalendar => e
    raise Invalid.new(CODES.fetch(e.class, "unreachable"), MESSAGES.fetch(e.class, FETCH_FAILED))
  end
end
