# Counts the SELECTs Active Record ran during a block — the read-side companion to
# `sql_writes_during` in spec/support/workos_auth.rb.
#
# It exists for one kind of assertion, and it is the only one worth making about query counts: that
# a list endpoint costs the SAME number of queries whether it returns two houses or twenty. A bare
# upper bound drifts upward every time someone adds a legitimate query; "the count does not grow
# with the number of rows" is the actual invariant, and it is what fails loudly the day somebody
# moves a count inside the loop.
module QueryCounter
  def sql_selects_during
    statements = []

    subscriber = ActiveSupport::Notifications.subscribe("sql.active_record") do |*, payload|
      # SCHEMA statements are Active Record inspecting columns, which it does once per process and
      # not per row; a cached statement did not reach the database at all.
      next if payload[:name] == "SCHEMA" || payload[:cached]

      statements << payload[:sql] if payload[:sql].match?(/\A\s*SELECT\b/i)
    end

    yield
    statements
  ensure
    ActiveSupport::Notifications.unsubscribe(subscriber)
  end
end

RSpec.configure { |config| config.include QueryCounter }
