# Printers for AnalyticsReport. The logic is in app/services/analytics_report.rb, where it can be
# tested against seeded events; nothing here does arithmetic.
#
# Note for zsh: brackets are globs, so quote the task name — bin/rails "analytics:funnel[30]".
#
# A super admin page for all of this is a follow-up ticket. These tasks exist so the numbers are
# readable the day the events start arriving rather than the day a screen is built for them.
namespace :analytics do
  desc "The funnel over the last N days (default 7), step by step, plus the number that matters"
  task :funnel, [ :days ] => :environment do |_task, args|
    days = Integer(args[:days] || 7)
    report = AnalyticsReport.funnel(days: days)

    puts "Funnel, last #{days} #{'day'.pluralize(days)} (since #{report[:since].utc.iso8601})"
    puts

    width = AnalyticsEvent::FUNNEL.map(&:length).max
    report[:steps].each do |step|
      conversion = step[:conversion]
      suffix = conversion.nil? ? "" : "   #{format('%.1f', conversion)}% of the step before"
      puts "  #{step[:name].ljust(width)}  #{step[:count].to_s.rjust(6)}#{suffix}"
    end
    puts
    puts "  The first four steps count VISITS; the rest count HOUSES, first_member_link_opened"
    puts "  included (it fires per housemate, so the step counts houses with at least one open)."

    # Beside step 1, because "how many visits" and "how many browsers" are different findings and
    # only the second one says whether a link worked. Views per visitor to ONE DECIMAL: a figure
    # never renders coarser than it was computed (project rule).
    views = report[:steps].first[:count]
    visitors = report[:unique_visitors]
    puts
    if visitors.zero?
      # Nought visitors against real views is not "nobody came", it is "nobody was counted": a
      # window older than the visitor code, or a deploy with no ANALYTICS_SHARED_SECRET. Printing
      # "0 visitors" under a healthy view count would be a lie with a number on it.
      puts "  #{'landing_view'.ljust(width)}  #{views.to_s.rjust(6)}   no visitor counted in this window"
      puts "  (a visit is counted as a browser only when the daily visitor code reached it)"
    else
      each = format("%.1f", views.to_f / visitors)
      puts "  #{'browsers'.ljust(width)}  #{visitors.to_s.rjust(6)}   #{each} views each"
      puts "  A browser counts once a day: three days of one browser is three, thirty reloads is one."
    end

    side = report[:calendar_connected]
    side_suffix = side[:conversion].nil? ? "" : "   #{format('%.1f', side[:conversion])}% of houses named"
    puts
    puts "  #{'calendar_connected'.ljust(width)}  #{side[:count].to_s.rjust(6)}#{side_suffix}   (side branch)"

    activation = report[:activation]
    rate = activation[:rate].nil? ? "no houses named yet" : "#{format('%.1f', activation[:rate])}%"
    puts
    puts "  Houses with a text delivered AND two housemates' links opened within seven days:"
    puts "    #{activation[:converted]} of #{activation[:total]} houses named  (#{rate})"
    puts
    puts "  This is the number to know before buying or posting anywhere."
  end

  # What each landing-view table is called. Presentation, so it lives here rather than in the report.
  VISIT_TABLES = {
    "referrer_host" => "Which site linked here",
    "country" => "Country",
    "city" => "City",
    "device" => "Device",
    "browser" => "Browser",
    "os" => "Operating system"
  }.freeze

  desc "Where the last N days (default 7) came from: houses by first touch, then the visits by referrer, country, city, device, browser and system"
  task :sources, [ :days ] => :environment do |_task, args|
    days = Integer(args[:days] || 7)
    window = "last #{days} #{'day'.pluralize(days)}"
    rows = AnalyticsReport.sources(days: days)

    puts "Houses named, #{window}, by first touch"
    puts

    if rows.empty?
      puts "  No houses named in this window."
    else
      rows.each do |row|
        label = [ row[:ref] && "ref=#{row[:ref]}", row[:utm_source] && "utm_source=#{row[:utm_source]}" ]
          .compact.join("  ").presence || "(direct, no campaign)"
        puts "  #{row[:count].to_s.rjust(6)}  #{label}"
      end
    end

    visits = AnalyticsReport.visit_sources(days: days)
    views = visits.values.first[:total]

    puts
    puts "Landing views, #{window}: #{views} #{'view'.pluralize(views)}"

    VISIT_TABLES.each do |key, heading|
      table = visits.fetch(key)
      puts
      puts "  #{heading}"

      printable = table[:top].map { |row| [ row[:count], row[:value] ] }
      # Always last, whatever its size. It is the row that says what the table above it cannot see —
      # a direct visit, or a city header that is not arriving — and reading it as the winner of a
      # ranking would be the wrong way round.
      printable << [ table[:none], "(none)" ] if table[:none].positive?

      if printable.empty?
        puts "    Nothing to show for this window."
      else
        printable.each { |count, label| puts "    #{count.to_s.rjust(6)}  #{label}" }
      end
    end

    puts
    puts "  (none) is a visit the property is missing from. A direct arrival for the referrer, and"
    puts "  every visit for the city until the Cloudflare zone's \"Add visitor location headers\""
    puts "  transform is switched on: the header is not sent before that."
  end

  desc "Delete anonymous events older than N days (default 180) and every expired visitor code. A house's own events are kept."
  task :prune, [ :days ] => :environment do |_task, args|
    days = Integer(args[:days] || 180)
    deleted = AnalyticsEvent.prune_anonymous(older_than: days.days)

    puts "Pruned #{deleted} anonymous #{'event'.pluralize(deleted)} older than #{days} days."
    puts "Events belonging to a house were not touched; they go when the house does."

    # The second table, and it takes no argument. A visitor code is only meaningful on the day it
    # was made — the salt behind it changes at midnight — so "how long to keep one" is not a choice
    # anybody should be making at the command line. DailyVisitor::RETENTION is the rule, and the
    # privacy page promises it in words.
    codes = DailyVisitor.prune

    puts
    puts "Pruned #{codes} daily visitor #{'code'.pluralize(codes)}: everything before yesterday."
    puts "A code means nothing after the day it was made, because the salt behind it has changed."
  end
end
