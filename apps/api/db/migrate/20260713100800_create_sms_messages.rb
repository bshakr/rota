class CreateSmsMessages < ActiveRecord::Migration[8.1]
  def change
    create_table :sms_messages do |t|
      t.string :kind, null: false
      t.references :shift, null: false, foreign_key: true
      t.references :member, null: false, foreign_key: true
      # Which reminder this is: 3 = "three days before". NULL for a cover notice, which is not
      # tied to an offset. See the check constraint below — for a reminder this is never NULL.
      t.integer :days_before
      # NULL until SendSmsJob renders the template. The sweep inserts a `pending` row first, to
      # *claim* the reminder via the unique index below; rendering happens in the job.
      t.text :body
      t.string :twilio_sid
      t.string :status, null: false, default: "pending"
      # Twilio's carrier error code, e.g. "30006". A string because it arrives as one and
      # nothing here does arithmetic on it.
      t.string :error_code
      t.datetime :sent_at

      t.timestamps
    end

    add_check_constraint :sms_messages, "kind IN ('reminder', 'cover_notice')",
      name: "sms_messages_kind_known"
    add_check_constraint :sms_messages, "status IN ('pending', 'sent', 'delivered', 'failed')",
      name: "sms_messages_status_known"
    add_check_constraint :sms_messages, "days_before IS NULL OR days_before >= 0",
      name: "sms_messages_days_before_non_negative"

    # THIS is the reminder engine's idempotency mechanism, and the reason it is an index and not
    # a model validation: a validation reads-then-writes and therefore races, so two overlapping
    # sweeps both see "no reminder yet" and both send. A unique index cannot race — the second
    # writer gets a constraint violation and skips. Double-texting becomes structurally
    # impossible rather than merely unlikely.
    #
    # Partial, because it must constrain reminders only: a shift can accumulate any number of
    # cover_notice rows as it is handed on, and those carry no days_before at all.
    add_index :sms_messages, [ :shift_id, :days_before ],
      unique: true,
      where: "kind = 'reminder'",
      name: "index_sms_messages_on_reminder_idempotency"

    # Postgres treats NULLs as distinct inside a unique index, so a reminder row with a NULL
    # days_before would slip past the index above — every time. That single hole would defeat the
    # whole mechanism, so it is closed here rather than left to the model to remember.
    add_check_constraint :sms_messages, "kind <> 'reminder' OR days_before IS NOT NULL",
      name: "sms_messages_reminder_has_days_before"

    # The Twilio status webhook looks a message up by SID; making it unique also makes a
    # redelivered webhook idempotent rather than ambiguous. NULLs are distinct, so the many rows
    # still waiting on a SID do not collide.
    add_index :sms_messages, :twilio_sid, unique: true
  end
end
