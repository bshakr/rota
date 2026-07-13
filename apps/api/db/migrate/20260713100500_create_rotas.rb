class CreateRotas < ActiveRecord::Migration[8.1]
  def change
    create_table :rotas do |t|
      t.references :group, null: false, foreign_key: true
      t.string :name, null: false
      t.text :message_template, null: false
      t.date :starts_on, null: false
      t.integer :interval_count, null: false
      t.string :interval_unit, null: false
      t.integer :send_hour, null: false, default: 9
      # Day-offsets before the shift, e.g. {3,0} = "three days before, and on the day".
      # Empty means the rota sends no reminders. Stored sorted descending; see Rota.
      t.integer :reminder_offsets, array: true, null: false, default: []
      t.boolean :active, null: false, default: true

      t.timestamps
    end

    # These mirror the model validations. The model is what produces a decent error message for
    # the admin; these are what stop a stray `update_column` or a future backfill writing a rota
    # the shift generator cannot interpret.
    add_check_constraint :rotas, "interval_count > 0",
      name: "rotas_interval_count_positive"
    add_check_constraint :rotas, "interval_unit IN ('day', 'week', 'month')",
      name: "rotas_interval_unit_known"
    add_check_constraint :rotas, "send_hour BETWEEN 0 AND 23",
      name: "rotas_send_hour_in_range"
  end
end
