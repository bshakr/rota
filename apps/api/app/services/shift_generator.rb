# Ensures a rota's shifts exist as real rows, from its anchor date out to the far edge of the
# rolling window. It only ever ADDS. Deleting is RotaRegenerator's job, and only ever in the
# future.
#
# Shifts are materialised rather than computed on the fly precisely so that history can be honest:
# once a date has passed, the row records who was actually on the hook, cover included. Computing
# them on demand would mean adding a member retroactively rewrites who cleaned last month.
class ShiftGenerator
  WINDOW = 90.days

  # `starts_on + (i * interval_count).weeks`. Looked up rather than `send`-ed so that an unknown
  # unit is a loud KeyError rather than whichever Integer method happens to share its name.
  DURATIONS = { "day" => :days, "week" => :weeks, "month" => :months }.freeze

  def initialize(rota, window: WINDOW)
    @rota = rota
    @window = window
  end

  # Returns the number of shifts actually inserted.
  #
  # Idempotent, and safe to run concurrently with itself — which is what lets the daily top-up job,
  # a rota edit and a retry all fire at once without coordinating.
  def call
    rows = missing_rows
    return 0 if rows.empty?

    # `insert_all`, NOT `upsert_all`. Passing `unique_by` turns a conflict on (rota_id, due_on)
    # into ON CONFLICT DO NOTHING, so an existing row is left exactly as it stands — same
    # assignee, same cover, same timestamps. This one clause is what actually enforces the
    # immutable-history guarantee. An upsert would happily rewrite last month's assignee and
    # quietly destroy the record of who really cleaned.
    Shift.insert_all(rows, unique_by: %i[rota_id due_on], record_timestamps: true).length
  end

  # The far edge of the window, on the group's own calendar rather than the server's. See
  # Group#today.
  def horizon
    @horizon ||= rota.group.today + window
  end

  private

  attr_reader :rota, :window

  def missing_rows
    # Ordered by position — the association says so, and that ordering IS the rotation.
    member_ids = rota.rota_positions.pluck(:member_id)
    # No roster means nobody to assign, which is exactly what `draft?` means. Generation is a
    # no-op, not an error: a half-built rota is a normal state, not a broken one.
    return [] if member_ids.empty?

    series.each_with_index.map do |due_on, index|
      {
        rota_id: rota.id,
        due_on: due_on,
        # The wrap-around IS the rotation.
        assigned_member_id: member_ids[index % member_ids.size]
      }
    end
  end

  # Every date in the series, from the anchor to the horizon.
  #
  # Each date is computed from `starts_on` rather than from its predecessor, and that is not a
  # stylistic choice. ActiveSupport clamps 31 Jan + 1.month to 28 Feb; stepping forward from that
  # result would give 28 Mar and every month after would stay stuck on the 28th, drifting away
  # from the date the admin actually asked for. Anchoring every date on `starts_on` means the
  # clamp is temporary — 31 Jan + 2.months is 31 Mar — and the series self-corrects.
  #
  # Terminates because `interval_count` is at least 1 (model validation, plus a check constraint
  # in Postgres), so the dates strictly increase.
  def series
    duration = DURATIONS.fetch(rota.interval_unit)
    dates = []
    index = 0

    loop do
      date = rota.starts_on + (index * rota.interval_count).public_send(duration)
      break if date > horizon

      dates << date
      index += 1
    end

    dates
  end
end
