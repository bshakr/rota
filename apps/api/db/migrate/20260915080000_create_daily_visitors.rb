# One row per browser per day, and it survives about a day.
#
# This is the whole of how Rota Monster counts VISITORS rather than visits without setting a cookie.
# The web app hashes the visit's address and agent with a salt that changes at midnight UTC and
# sends the result in a header; this table is where that code is remembered just long enough for
# "have I seen this one today?" to have an answer, and the answer lands on the landing view as a
# `first_visit_today` property. See DailyVisitor.
#
# What it deliberately cannot do: link a visit to a person, or to a visit on another day. There is
# no foreign key here, nothing joinable to analytics_events, and the code itself is unrecoverable
# from one day to the next because the salt it was made with is gone.
class CreateDailyVisitors < ActiveRecord::Migration[8.1]
  def change
    create_table :daily_visitors do |t|
      # The UTC day the code belongs to, as a DATE. It is the whole of the retention rule — the
      # pruner deletes by it — and it is half of the uniqueness rule below.
      t.date :day, null: false

      # Sixty-four characters of hex: SHA-256, as the web app computed it. Capped at exactly its own
      # length so a value that is not one cannot be stored even if the controller's check ever
      # stopped running.
      t.string :digest, limit: 64, null: false

      # THE index this table exists for. It makes the insert an upsert — `insert_all` with
      # `unique_by` turns a repeat visit into ON CONFLICT DO NOTHING, and whether a row was taken is
      # exactly the answer "is this the first visit today?" — and it is what the lookup would use
      # anyway. Day first, because the pruner and every future question about this table start from
      # a day.
      t.index %i[day digest], unique: true
    end

    # No timestamps. `day` is the only fact about a row that anything reads, and a created_at would
    # be a SECOND, finer moment attached to a visitor code: a column that narrows a visit down to
    # the minute is precisely what this table promises not to hold.
  end
end
