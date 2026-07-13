class CreateRotaPositions < ActiveRecord::Migration[8.1]
  def change
    create_table :rota_positions do |t|
      # The (rota_id, position) unique index below leads on rota_id, so it serves lookups by rota.
      t.references :rota, null: false, foreign_key: true, index: false
      t.references :member, null: false, foreign_key: true
      t.integer :position, null: false

      t.timestamps
    end

    # The rotation is `positions[i % positions.count]`, so the order must be unambiguous.
    add_index :rota_positions, [ :rota_id, :position ], unique: true

    # A rota's roster is an ordered *subset* of the group's members. Listing the same member
    # twice would silently give them two turns per cycle, which nobody has ever asked for.
    add_index :rota_positions, [ :rota_id, :member_id ], unique: true

    add_check_constraint :rota_positions, "position >= 0",
      name: "rota_positions_position_non_negative"
  end
end
