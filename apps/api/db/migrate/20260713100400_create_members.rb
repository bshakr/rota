class CreateMembers < ActiveRecord::Migration[8.1]
  def change
    create_table :members do |t|
      t.references :group, null: false, foreign_key: true
      t.string :name, null: false
      t.string :phone_e164, null: false
      t.string :access_token, null: false
      t.boolean :active, null: false, default: true
      t.datetime :sms_opted_out_at

      t.timestamps
    end

    # The magic link is a token on the member, not on the shift: one stable link per person,
    # included in every SMS. Every member request authenticates by looking this up, so it is the
    # hottest index in the schema as well as a uniqueness guarantee.
    add_index :members, :access_token, unique: true
  end
end
