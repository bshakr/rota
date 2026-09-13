# This file is auto-generated from the current state of the database. Instead
# of editing this file, please use the migrations feature of Active Record to
# incrementally modify your database, and then regenerate this schema definition.
#
# This file is the source Rails uses to define your schema when running `bin/rails
# db:schema:load`. When creating a new database, `bin/rails db:schema:load` tends to
# be faster and is potentially less error prone than running all of your
# migrations from scratch. Old migrations may fail to apply correctly if those
# migrations use external dependencies or application code.
#
# It's strongly recommended that you check this file into your version control system.

ActiveRecord::Schema[8.1].define(version: 2026_09_14_100100) do
  # These are extensions that must be enabled in order to support this database
  enable_extension "pg_catalog.plpgsql"

  create_table "ai_calls", force: :cascade do |t|
    t.integer "cache_creation_input_tokens"
    t.integer "cache_read_input_tokens"
    t.bigint "calendar_connection_id"
    t.decimal "cost_usd", precision: 12, scale: 6
    t.datetime "created_at", null: false
    t.string "error_class"
    t.bigint "group_id", null: false
    t.integer "input_tokens"
    t.integer "items_count"
    t.string "model", null: false
    t.integer "output_tokens"
    t.string "purpose", null: false
    t.boolean "succeeded", null: false
    t.index ["calendar_connection_id"], name: "index_ai_calls_on_calendar_connection_id"
    t.index ["created_at"], name: "index_ai_calls_on_created_at"
    t.index ["group_id", "created_at"], name: "index_ai_calls_on_group_id_and_created_at"
  end

  create_table "calendar_connections", force: :cascade do |t|
    t.string "calendar_name"
    t.integer "consecutive_failures", default: 0, null: false
    t.datetime "created_at", null: false
    t.datetime "disabled_at"
    t.string "etag"
    t.integer "events_count", default: 0, null: false
    t.bigint "group_id", null: false
    t.string "ical_url", null: false
    t.string "last_error"
    t.datetime "last_fetched_at"
    t.string "last_modified"
    t.datetime "last_synced_at"
    t.datetime "updated_at", null: false
    t.index ["group_id"], name: "index_calendar_connections_on_group_id", unique: true
  end

  create_table "calendar_event_members", force: :cascade do |t|
    t.bigint "calendar_event_id", null: false
    t.bigint "member_id", null: false
    t.index ["calendar_event_id", "member_id"], name: "idx_on_calendar_event_id_member_id_9a492082f1", unique: true
    t.index ["calendar_event_id"], name: "index_calendar_event_members_on_calendar_event_id"
    t.index ["member_id"], name: "index_calendar_event_members_on_member_id"
  end

  create_table "calendar_events", force: :cascade do |t|
    t.boolean "all_day", default: false, null: false
    t.bigint "calendar_connection_id", null: false
    t.datetime "classified_at"
    t.datetime "created_at", null: false
    t.datetime "ends_at"
    t.date "ends_on", null: false
    t.string "fingerprint", null: false
    t.string "instance_key", null: false
    t.string "kind", default: "event", null: false
    t.string "reason"
    t.datetime "starts_at"
    t.date "starts_on", null: false
    t.string "summary", null: false
    t.datetime "synced_at", null: false
    t.string "uid", null: false
    t.datetime "updated_at", null: false
    t.index ["calendar_connection_id", "fingerprint"], name: "idx_on_calendar_connection_id_fingerprint_058b0951e8"
    t.index ["calendar_connection_id", "instance_key"], name: "idx_on_calendar_connection_id_instance_key_0a4048655b", unique: true
    t.index ["calendar_connection_id", "starts_on"], name: "index_calendar_events_on_calendar_connection_id_and_starts_on"
    t.index ["calendar_connection_id"], name: "index_calendar_events_on_calendar_connection_id"
    t.check_constraint "kind::text = ANY (ARRAY['event'::character varying, 'away'::character varying]::text[])", name: "calendar_events_kind_known"
  end

  create_table "group_admins", force: :cascade do |t|
    t.datetime "created_at", null: false
    t.bigint "group_id", null: false
    t.string "role", default: "member", null: false
    t.datetime "updated_at", null: false
    t.bigint "user_id", null: false
    t.index ["group_id"], name: "index_group_admins_on_group_id"
    t.index ["user_id", "group_id"], name: "index_group_admins_on_user_id_and_group_id", unique: true
  end

  create_table "groups", force: :cascade do |t|
    t.datetime "created_at", null: false
    t.string "name", null: false
    t.string "slug", default: -> { "('household-'::text || substr(md5((random())::text), 1, 16))" }, null: false
    t.string "timezone", null: false
    t.datetime "timezone_confirmed_at"
    t.datetime "updated_at", null: false
    t.string "workos_organization_id", null: false
    t.index ["slug"], name: "index_groups_on_slug", unique: true
    t.index ["workos_organization_id"], name: "index_groups_on_workos_organization_id", unique: true
  end

  create_table "members", force: :cascade do |t|
    t.string "access_token", null: false
    t.boolean "active", default: true, null: false
    t.datetime "created_at", null: false
    t.bigint "group_id", null: false
    t.string "name", null: false
    t.string "phone_e164", null: false
    t.datetime "sms_opted_out_at"
    t.datetime "updated_at", null: false
    t.index ["access_token"], name: "index_members_on_access_token", unique: true
    t.index ["group_id"], name: "index_members_on_group_id"
  end

  create_table "rota_positions", force: :cascade do |t|
    t.datetime "created_at", null: false
    t.bigint "member_id", null: false
    t.integer "position", null: false
    t.bigint "rota_id", null: false
    t.datetime "updated_at", null: false
    t.index ["member_id"], name: "index_rota_positions_on_member_id"
    t.index ["rota_id", "member_id"], name: "index_rota_positions_on_rota_id_and_member_id", unique: true
    t.index ["rota_id", "position"], name: "index_rota_positions_on_rota_id_and_position", unique: true
    t.check_constraint "\"position\" >= 0", name: "rota_positions_position_non_negative"
  end

  create_table "rotas", force: :cascade do |t|
    t.boolean "active", default: true, null: false
    t.datetime "created_at", null: false
    t.bigint "group_id", null: false
    t.integer "interval_count", null: false
    t.string "interval_unit", null: false
    t.text "message_template", null: false
    t.string "name", null: false
    t.integer "reminder_offsets", default: [], null: false, array: true
    t.integer "send_hour", default: 9, null: false
    t.date "starts_on", null: false
    t.datetime "updated_at", null: false
    t.index ["group_id"], name: "index_rotas_on_group_id"
    t.check_constraint "interval_count > 0", name: "rotas_interval_count_positive"
    t.check_constraint "interval_unit::text = ANY (ARRAY['day'::character varying, 'week'::character varying, 'month'::character varying]::text[])", name: "rotas_interval_unit_known"
    t.check_constraint "send_hour >= 0 AND send_hour <= 23", name: "rotas_send_hour_in_range"
  end

  create_table "shifts", force: :cascade do |t|
    t.bigint "assigned_member_id", null: false
    t.bigint "covering_member_id"
    t.datetime "created_at", null: false
    t.date "due_on", null: false
    t.bigint "rota_id", null: false
    t.datetime "updated_at", null: false
    t.index ["assigned_member_id"], name: "index_shifts_on_assigned_member_id"
    t.index ["covering_member_id"], name: "index_shifts_on_covering_member_id"
    t.index ["due_on"], name: "index_shifts_on_due_on"
    t.index ["rota_id", "due_on"], name: "index_shifts_on_rota_id_and_due_on", unique: true
    t.check_constraint "covering_member_id IS NULL OR covering_member_id <> assigned_member_id", name: "shifts_cover_differs_from_assignee"
  end

  create_table "sms_messages", force: :cascade do |t|
    t.text "body"
    t.datetime "created_at", null: false
    t.integer "days_before"
    t.string "error_code"
    t.string "kind", null: false
    t.bigint "member_id", null: false
    t.datetime "sent_at"
    t.bigint "shift_id"
    t.string "status", default: "pending", null: false
    t.string "twilio_sid"
    t.datetime "updated_at", null: false
    t.index ["created_at"], name: "index_sms_messages_on_login_time", where: "((kind)::text = 'member_login'::text)"
    t.index ["member_id"], name: "index_sms_messages_on_member_id"
    t.index ["shift_id", "days_before"], name: "index_sms_messages_on_reminder_idempotency", unique: true, where: "((kind)::text = 'reminder'::text)"
    t.index ["shift_id"], name: "index_sms_messages_on_shift_id"
    t.index ["twilio_sid"], name: "index_sms_messages_on_twilio_sid", unique: true
    t.check_constraint "days_before IS NULL OR days_before >= 0", name: "sms_messages_days_before_non_negative"
    t.check_constraint "kind::text <> 'reminder'::text OR days_before IS NOT NULL", name: "sms_messages_reminder_has_days_before"
    t.check_constraint "kind::text = 'member_login'::text AND shift_id IS NULL AND days_before IS NULL OR kind::text <> 'member_login'::text AND shift_id IS NOT NULL", name: "sms_messages_shift_for_kind"
    t.check_constraint "kind::text = ANY (ARRAY['reminder'::character varying, 'cover_notice'::character varying, 'member_login'::character varying]::text[])", name: "sms_messages_kind_known"
    t.check_constraint "status::text = ANY (ARRAY['pending'::character varying, 'sending'::character varying, 'sent'::character varying, 'delivered'::character varying, 'failed'::character varying]::text[])", name: "sms_messages_status_known"
  end

  create_table "users", force: :cascade do |t|
    t.datetime "created_at", null: false
    t.string "email", null: false
    t.string "name"
    t.datetime "updated_at", null: false
    t.string "workos_user_id", null: false
    t.index ["workos_user_id"], name: "index_users_on_workos_user_id", unique: true
  end

  add_foreign_key "ai_calls", "calendar_connections", on_delete: :nullify
  add_foreign_key "ai_calls", "groups"
  add_foreign_key "calendar_connections", "groups"
  add_foreign_key "calendar_event_members", "calendar_events", on_delete: :cascade
  add_foreign_key "calendar_event_members", "members", on_delete: :cascade
  add_foreign_key "calendar_events", "calendar_connections", on_delete: :cascade
  add_foreign_key "group_admins", "groups"
  add_foreign_key "group_admins", "users"
  add_foreign_key "members", "groups"
  add_foreign_key "rota_positions", "members"
  add_foreign_key "rota_positions", "rotas"
  add_foreign_key "rotas", "groups"
  add_foreign_key "shifts", "members", column: "assigned_member_id"
  add_foreign_key "shifts", "members", column: "covering_member_id"
  add_foreign_key "shifts", "rotas"
  add_foreign_key "sms_messages", "members"
  add_foreign_key "sms_messages", "shifts"
end
