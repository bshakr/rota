class CreateUsers < ActiveRecord::Migration[8.1]
  def change
    create_table :users do |t|
      t.string :workos_user_id, null: false
      t.string :email, null: false
      # Nullable: WorkOS does not always have a name for a user, and the just-in-time upsert on
      # an authenticated request must never fail for want of a display string.
      t.string :name

      t.timestamps
    end

    add_index :users, :workos_user_id, unique: true
  end
end
