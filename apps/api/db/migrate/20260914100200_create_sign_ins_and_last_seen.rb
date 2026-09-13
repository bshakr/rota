class CreateSignInsAndLastSeen < ActiveRecord::Migration[8.1]
  def change
    # The top of the funnel. A user who signs in and abandons /setup never reaches an authenticated
    # endpoint, so without this row they are invisible to us forever — and unlike everything else on
    # the super admin dashboards, it cannot be backfilled from what we already store.
    create_table :sign_ins do |t|
      # index: false because the (user_id, created_at) index below already leads on user_id, and
      # every question asked of this table is "this person, in this range" or "everyone, in this
      # range". Not null: a sign-in with nobody signing in is not a fact about anything.
      t.references :user, null: false, foreign_key: true, index: false
      # Which house they had selected, if any. NULL is the interesting value, not a defect: it is
      # exactly the "signed in, has no house yet" step the conversion funnel exists to measure.
      # A string rather than a groups FK, because a sign-in can name an organization that has never
      # reached Rails and so has no group row to point at.
      t.string :workos_organization_id
      # The JWT id of the token that carried this sign-in. The unique index is what makes a retried
      # callback a no-op: the same token presented twice is the same sign-in, whatever the network
      # did in between. Nullable, because Postgres lets NULLs repeat and a token minted without a
      # `jti` is therefore recorded rather than refused — see Api::SignInsController.
      t.string :jti
      # created_at only. A sign-in is a fact about one instant; there is nothing about it to update
      # later, so there is no updated_at to pay for on every insert.
      t.datetime :created_at, null: false
      t.index %i[user_id created_at]
      t.index :created_at
      t.index :jti, unique: true
    end

    # "Last seen" for the two kinds of person in the product: the house admin who signs in with
    # WorkOS, and the housemate who taps a magic link. Nullable on purpose — NULL means "never seen
    # since this shipped", which is a different fact from "seen long ago" and must stay tellable
    # apart. Written by the throttled touch in Authenticatable and MemberAuthenticatable (see
    # LastSeen), never more than once an hour per person.
    add_column :users, :last_seen_at, :datetime
    add_column :members, :last_seen_at, :datetime
  end
end
