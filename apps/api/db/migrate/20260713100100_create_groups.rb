class CreateGroups < ActiveRecord::Migration[8.1]
  def change
    create_table :groups do |t|
      t.string :workos_organization_id, null: false
      t.string :name, null: false
      t.string :timezone, null: false

      t.timestamps
    end

    # WorkOS Organizations is the source of truth for admin identity; this column is the join
    # back to it, and the JIT upsert on every authenticated request keys on it.
    add_index :groups, :workos_organization_id, unique: true
  end
end
