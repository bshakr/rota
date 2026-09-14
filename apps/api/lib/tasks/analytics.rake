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

  desc "Houses named in the last N days (default 7), grouped by where they came from"
  task :sources, [ :days ] => :environment do |_task, args|
    days = Integer(args[:days] || 7)
    rows = AnalyticsReport.sources(days: days)

    puts "Houses named, last #{days} #{'day'.pluralize(days)}, by first touch"
    puts

    if rows.empty?
      puts "  No houses named in this window."
      next
    end

    rows.each do |row|
      label = [ row[:ref] && "ref=#{row[:ref]}", row[:utm_source] && "utm_source=#{row[:utm_source]}" ]
        .compact.join("  ").presence || "(direct, no campaign)"
      puts "  #{row[:count].to_s.rjust(6)}  #{label}"
    end
  end

  desc "Delete anonymous events older than N days (default 90). A house's own events are kept."
  task :prune, [ :days ] => :environment do |_task, args|
    days = Integer(args[:days] || 90)
    deleted = AnalyticsEvent.prune_anonymous(older_than: days.days)

    puts "Pruned #{deleted} anonymous #{'event'.pluralize(deleted)} older than #{days} days."
    puts "Events belonging to a house were not touched; they go when the house does."
  end
end
