# The admin join table is `group_admins`, not `memberships`. With participants called Members,
# "membership" would be ambiguous between "a person on a rota" and "an admin's access to a
# group". The word *member* only ever means "a person who takes turns".
class CreateGroupAdmins < ActiveRecord::Migration[8.1]
  def change
    create_table :group_admins do |t|
      # The unique index below leads on user_id, so it already serves lookups by user.
      t.references :user, null: false, foreign_key: true, index: false
      t.references :group, null: false, foreign_key: true
      # WorkOS owns this vocabulary (its organization role slug), so it is not constrained here.
      t.string :role, null: false, default: "member"

      t.timestamps
    end

    add_index :group_admins, [ :user_id, :group_id ], unique: true
  end
end
