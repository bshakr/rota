# What the events add up to.
#
# Three questions, and only three, because the point of this wave was to stop guessing before any
# money is spent on traffic rather than to build a dashboard:
#
#   funnel      how many reached each step, and what fraction of the step before it
#   activation  THE number: houses with a text delivered AND two housemates who opened, within seven
#               days of being named
#   sources     which campaigns the named houses came from, and where the visits came from
#
# The logic lives here rather than in the rake tasks so it can be tested against seeded events. The
# tasks are printers.
#
# Every query is deliberately small and obvious rather than one clever SQL statement. This table has
# a handful of rows per house; the cost of a few extra round trips is nothing next to the cost of a
# funnel nobody can read and therefore nobody trusts.
module AnalyticsReport
  # "Within seven days" from the marketing review, and it is the window the whole wave is named for.
  ACTIVATION_WINDOW = 7.days

  # Two housemates, not one: one is the person who set the house up.
  OPENS_REQUIRED = 2

  # The three coarse facts a landing view carries about the visit, in the order they are worth
  # reading: which site sent them, roughly where they were, and what they were holding.
  VISIT_DIMENSIONS = %w[referrer_host country device].freeze

  # Enough to see where traffic is actually coming from. A long tail of one-view referrers is not a
  # finding, and the (none) row and the total below each table say what the ten leave out.
  VISIT_ROWS_SHOWN = 10

  module_function

  def funnel(days:, now: Time.current)
    since = now - days.days
    counts = AnalyticsEvent.since(since).group(:name).count

    # `first_member_link_opened` is the one event that fires once per HOUSEMATE rather than once per
    # house, so its raw row count is not comparable with the step before it — a house with two
    # housemates who opened would read as "200% of houses that got a text", which is the sort of
    # number that makes a reader stop believing the whole report. The step therefore counts HOUSES
    # with at least one open. How many housemates opened is the activation number's job, below.
    counts[AnalyticsEvent::FIRST_MEMBER_LINK_OPENED] = AnalyticsEvent
      .named(AnalyticsEvent::FIRST_MEMBER_LINK_OPENED).since(since).distinct.count(:group_id)

    steps = AnalyticsEvent::FUNNEL.each_with_object([]) do |name, out|
      count = counts.fetch(name, 0)
      previous = out.last
      out << { name: name, count: count, conversion: rate(count, previous&.fetch(:count)) }
    end

    {
      days: days,
      since: since,
      steps: steps,
      # A side branch off house_named rather than a step between two others, so it is reported
      # against house_named and kept out of the sequence.
      calendar_connected: {
        count: counts.fetch(AnalyticsEvent::CALENDAR_CONNECTED, 0),
        conversion: rate(counts.fetch(AnalyticsEvent::CALENDAR_CONNECTED, 0),
                         counts.fetch(AnalyticsEvent::HOUSE_NAMED, 0))
      },
      activation: activation(days: days, now: now)
    }
  end

  # The one number that matters. Denominator: houses NAMED in the window — not houses that exist, and
  # not visits — because a house named yesterday has not had its seven days yet and counting it
  # against the rate would make every recent week look like a failure.
  def activation(days:, now: Time.current)
    named = AnalyticsEvent.named(AnalyticsEvent::HOUSE_NAMED)
      .since(now - days.days)
      .where.not(group_id: nil)
      .order(:occurred_at)

    total = 0
    converted = 0
    seen = Set.new

    named.each do |event|
      # A house is named once, but if a replay ever produced a second row the first naming is the
      # one the clock should run from.
      next unless seen.add?(event.group_id)

      total += 1
      converted += 1 if activated?(event)
    end

    { converted: converted, total: total, rate: rate(converted, total) }
  end

  def sources(days:, now: Time.current)
    AnalyticsEvent.named(AnalyticsEvent::HOUSE_NAMED)
      .since(now - days.days)
      .pluck(:properties)
      .map { |properties| [ properties["ref"], properties["utm_source"] ] }
      .tally
      .map { |(ref, utm_source), count| { ref: ref, utm_source: utm_source, count: count } }
      .sort_by { |row| [ -row[:count], row[:ref].to_s, row[:utm_source].to_s ] }
  end

  # Where the landing views in the window came from, one small table per coarse property.
  #
  # Landing views only. A `cta_click` fires on a page whose referrer is our own, and counting those
  # would put Rota Monster at the top of its own referrer table; the other two properties ride on
  # every anonymous event, but a visit is the unit anybody asks this question in.
  #
  # The MISSING count is published beside each table rather than dropped, because for two of the
  # three it is the most important row on it. No referrer is a direct visit, which is usually the
  # biggest single source a small site has; no country is every visit made today, because the domain
  # is still DNS-only on Cloudflare and the header only arrives once traffic is proxied. A table that
  # silently left those out would read as "we have almost no traffic" rather than "we cannot see
  # where this traffic is from".
  #
  # One read, folded three ways in Ruby. This is a handful of rows per day and a rake task nobody
  # runs in a loop; three GROUP BYs would be three round trips to say the same thing.
  def visit_sources(days:, now: Time.current)
    properties = AnalyticsEvent.named(AnalyticsEvent::LANDING_VIEW)
      .since(now - days.days)
      .pluck(:properties)

    VISIT_DIMENSIONS.index_with do |key|
      counts = properties.map { |row| row[key] }.tally
      missing = counts.delete(nil).to_i

      {
        # Commonest first, then alphabetically, so two values with the same count never swap places
        # between two runs of the same task.
        top: counts.sort_by { |value, count| [ -count, value ] }
          .first(VISIT_ROWS_SHOWN)
          .map { |value, count| { value: value, count: count } },
        none: missing,
        total: properties.length
      }
    end
  end

  def activated?(named_event)
    window = named_event.occurred_at..(named_event.occurred_at + ACTIVATION_WINDOW)
    scope = AnalyticsEvent.where(group_id: named_event.group_id, occurred_at: window)

    return false unless scope.named(AnalyticsEvent::FIRST_TEXT_DELIVERED).exists?

    distinct_openers(scope) >= OPENS_REQUIRED
  end

  # Distinct housemates, not distinct events: `first_member_link_opened` is already once per member,
  # but counting rows rather than people would turn one enthusiastic housemate into two.
  def distinct_openers(scope)
    scope.named(AnalyticsEvent::FIRST_MEMBER_LINK_OPENED)
      .pluck(:properties)
      .filter_map { |properties| properties["member_id"] }
      .uniq
      .size
  end

  # One decimal, always. A rate rounded to a whole percent is a number that has been quietly made up.
  # nil rather than 0 when there is no denominator: "no houses were named" and "no named house
  # converted" are different findings and must not print the same.
  def rate(count, of)
    return nil if of.nil? || of.zero?

    ((count.to_f / of) * 100).round(1)
  end
end
