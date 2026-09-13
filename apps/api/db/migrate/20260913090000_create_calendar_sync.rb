class CreateCalendarSync < ActiveRecord::Migration[8.1]
  def change
    create_table :calendar_connections do |t|
      t.references :group, null: false, foreign_key: true, index: { unique: true }
      t.string :ical_url, null: false
      t.string :calendar_name
      t.string :etag
      t.string :last_modified
      t.datetime :last_fetched_at
      t.datetime :last_synced_at
      t.string :last_error
      t.integer :consecutive_failures, null: false, default: 0
      t.datetime :disabled_at
      t.integer :events_count, null: false, default: 0
      t.timestamps
    end

    create_table :calendar_events do |t|
      t.references :calendar_connection, null: false, foreign_key: { on_delete: :cascade }
      t.string :uid, null: false
      t.string :instance_key, null: false
      t.string :summary, null: false
      t.date :starts_on, null: false
      t.date :ends_on, null: false
      t.datetime :starts_at
      t.datetime :ends_at
      t.boolean :all_day, null: false, default: false
      t.string :kind, null: false, default: "event"
      # The verdict cache key (spec 7.3): the normalised title, the shape of the entry, and the
      # roster. Not null, because every occurrence is fingerprinted before anything is stored, even
      # when the model call then fails and `classified_at` stays null.
      t.string :fingerprint, null: false
      t.string :reason
      t.datetime :classified_at
      t.datetime :synced_at, null: false
      t.timestamps
      t.index %i[calendar_connection_id instance_key], unique: true
      t.index %i[calendar_connection_id starts_on]
      t.index %i[calendar_connection_id fingerprint]
      t.check_constraint "kind IN ('event', 'away')", name: "calendar_events_kind_known"
    end

    create_table :calendar_event_members do |t|
      t.references :calendar_event, null: false, foreign_key: { on_delete: :cascade }
      t.references :member, null: false, foreign_key: { on_delete: :cascade }
      t.index %i[calendar_event_id member_id], unique: true
    end
  end
end
