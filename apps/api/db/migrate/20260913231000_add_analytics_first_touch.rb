# Analytics, in three parts: somewhere to put an event, where a house came from, and whether the
# people in it ever turned up.
#
# `analytics_events` is the whole store. One row per thing that happened, with a name from a fixed
# allowlist (AnalyticsEvent::NAMES), a house when the event belongs to one, and a small jsonb bag of
# allowlisted properties. Nothing in here identifies a visitor: there is no device id, no session id
# and no cookie behind it, because the funnel is counted in aggregate and never replayed per person.
#
# The group foreign key CASCADES on purpose. Every other thing a house owns goes when the house goes
# (Group's dependent: :destroy), and its funnel history is not the exception that gets to outlive it.
# The alternative — nullify — would quietly turn a deleted house's `house_named` into an anonymous
# event and corrupt every count that keys off a NULL group_id.
#
# `groups.first_touch` is the UTM/ref set the browser carried on its FIRST visit to `/`, captured in
# a cookie before the WorkOS round trip drops the query string, and handed over once when the house
# is named. It is a small fixed-shape hash (see FirstTouch::KEYS) rather than five columns because
# nothing queries an individual campaign field in SQL.
#
# `members.first_opened_at` is the moment a housemate's magic link first authenticated. It exists
# because the one number that matters — houses with a text delivered and two housemates who opened
# within seven days — is a per-member fact with no timestamp anywhere else, and because it makes the
# `first_member_link_opened` event exactly-once under concurrency (a conditional UPDATE claims it).
class AddAnalyticsFirstTouch < ActiveRecord::Migration[8.1]
  def change
    create_table :analytics_events do |t|
      t.string :name, null: false
      # Nullable: the four events that happen before a house exists (landing_view, cta_click,
      # signin_started, signin_completed) belong to nobody, and that is the point of them.
      t.references :group, foreign_key: { on_delete: :cascade }
      t.jsonb :properties, null: false, default: {}
      # When it happened, as distinct from when the row was written. Every report reads this one.
      t.datetime :occurred_at, null: false

      t.timestamps
    end

    # Every query is "this event, over this window", so the pair is worth more than either alone.
    # The single-column index on occurred_at is what the 90-day prune sweeps on.
    add_index :analytics_events, [ :name, :occurred_at ]
    add_index :analytics_events, :occurred_at

    add_column :groups, :first_touch, :jsonb
    add_column :members, :first_opened_at, :datetime
  end
end
