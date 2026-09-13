class CreateAiCalls < ActiveRecord::Migration[8.1]
  def change
    create_table :ai_calls do |t|
      # The house that spent the money. Not null and not nullified on delete: a group is only ever
      # destroyed with everything it owns, and a spend row with nobody to bill is noise.
      #
      # index: false because the (group_id, created_at) index below already leads on group_id, and
      # every question the spend page asks is "this house, in this range".
      t.references :group, null: false, foreign_key: true, index: false
      # Nullify rather than cascade: an admin who pastes a new secret address replaces the
      # connection, and last quarter's Claude bill must not disappear with the old one.
      t.references :calendar_connection, null: true, foreign_key: { on_delete: :nullify }
      # What the call was for. One value today ("calendar_classify"); deliberately no check
      # constraint, because the next purpose is a new string and not a migration.
      t.string :purpose, null: false
      # The model id as sent, which is also the key into the rate table. Stored rather than assumed
      # so a row priced under Haiku stays readable after the model constant changes.
      t.string :model, null: false
      t.integer :input_tokens
      t.integer :output_tokens
      t.integer :cache_creation_input_tokens
      t.integer :cache_read_input_tokens
      # Titles in the chunk. A house re-paying for its whole calendar every hour shows up as a large
      # number here on every sync rather than hiding inside a monthly total.
      t.integer :items_count
      t.boolean :succeeded, null: false
      t.string :error_class
      # A snapshot, computed at write time from the rate table, so editing a rate reprices future
      # calls and never silently moves a quarter that has already been reported. Null when the model
      # is not in the rate table: the tokens are still the truth and can be priced by hand later.
      t.decimal :cost_usd, precision: 12, scale: 6
      # created_at only. A spend row is a fact about one request at one instant; there is nothing
      # about it to update later, unlike an sms_messages row that waits for Twilio to settle a price.
      t.datetime :created_at, null: false
      t.index %i[group_id created_at]
      t.index :created_at
    end
  end
end
