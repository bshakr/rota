# Each rota's reminders become rows with their own timing and text. The backfill is SQL so it does
# not depend on model code that will change. rotas.reminder_offsets and rotas.message_template stay
# (still written as a mirror for a rollback) until a follow-up drops them.
class CreateRotaReminders < ActiveRecord::Migration[8.1]
  BACKFILL_REMINDERS = <<~SQL.freeze
    INSERT INTO rota_reminders (rota_id, days_before, message_template, created_at, updated_at)
    SELECT DISTINCT ON (rotas.id, o.days) rotas.id, o.days, rotas.message_template, NOW(), NOW()
    FROM rotas
    CROSS JOIN LATERAL unnest(rotas.reminder_offsets) WITH ORDINALITY AS o(days, ord)
    WHERE o.days IS NOT NULL
    ORDER BY rotas.id, o.days, o.ord
  SQL

  # A text belongs to the reminder at its timing on its shift's rota. Timings were unique per rota,
  # so the match is exact; a text at a timing since removed keeps no reminder.
  LINK_REMINDER_TEXTS = <<~SQL.freeze
    UPDATE sms_messages
    SET rota_reminder_id = rota_reminders.id
    FROM shifts, rota_reminders
    WHERE sms_messages.kind = 'reminder'
      AND shifts.id = sms_messages.shift_id
      AND rota_reminders.rota_id = shifts.rota_id
      AND rota_reminders.days_before = sms_messages.days_before
  SQL

  def up
    create_table :rota_reminders do |t|
      t.references :rota, null: false, foreign_key: { on_delete: :cascade }
      t.integer :days_before, null: false
      t.text :message_template, null: false
      t.timestamps
    end
    # Floor only: the previous API never capped offsets, so a legacy one above the app's 365 must
    # still backfill. RotaReminder validates the full range on every save.
    add_check_constraint :rota_reminders, "days_before >= -14",
      name: "rota_reminders_days_before_floor"

    execute BACKFILL_REMINDERS

    add_reference :sms_messages, :rota_reminder, foreign_key: { on_delete: :nullify }

    execute LINK_REMINDER_TEXTS

    remove_index :sms_messages, name: "index_sms_messages_on_reminder_idempotency"
    add_index :sms_messages, [ :shift_id, :rota_reminder_id ], unique: true,
      where: "kind = 'reminder' AND rota_reminder_id IS NOT NULL",
      name: "index_sms_messages_on_reminder_idempotency"
    remove_check_constraint :sms_messages, name: "sms_messages_days_before_non_negative"

    change_column_null :rotas, :message_template, true
  end

  # Fails (and rolls back whole) once data the old schema cannot hold exists: a rota without a
  # template, a negative timing on a text, or two reminders at one timing texted for the same shift.
  def down
    change_column_null :rotas, :message_template, false
    add_check_constraint :sms_messages, "days_before IS NULL OR days_before >= 0",
      name: "sms_messages_days_before_non_negative"
    remove_index :sms_messages, name: "index_sms_messages_on_reminder_idempotency"
    add_index :sms_messages, [ :shift_id, :days_before ], unique: true,
      where: "kind = 'reminder'", name: "index_sms_messages_on_reminder_idempotency"
    remove_reference :sms_messages, :rota_reminder, foreign_key: true
    drop_table :rota_reminders
  end
end
