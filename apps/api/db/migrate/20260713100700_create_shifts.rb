class CreateShifts < ActiveRecord::Migration[8.1]
  def change
    create_table :shifts do |t|
      # The (rota_id, due_on) unique index below leads on rota_id, so it serves lookups by rota.
      t.references :rota, null: false, foreign_key: true, index: false
      t.date :due_on, null: false
      # What the rota says...
      t.references :assigned_member, null: false, foreign_key: { to_table: :members }
      # ...and the override. This one nullable column is the entire swap feature.
      t.references :covering_member, null: true, foreign_key: { to_table: :members }

      t.timestamps
    end

    # Generation is `INSERT ... ON CONFLICT (rota_id, due_on) DO NOTHING`, which is what enforces
    # the immutable-history guarantee: an upsert would happily rewrite last month's assignee and
    # quietly destroy the record of who really cleaned. This index is that conflict target.
    add_index :shifts, [ :rota_id, :due_on ], unique: true

    # The reminder sweep asks "which shifts are due soon?" across every rota at once.
    add_index :shifts, :due_on

    # Handing a shift to the person already holding it is a no-op the cover flow should never
    # persist, and it would make `responsible_member` ambiguous to read.
    add_check_constraint :shifts,
      "covering_member_id IS NULL OR covering_member_id <> assigned_member_id",
      name: "shifts_cover_differs_from_assignee"
  end
end
