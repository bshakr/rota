require "rails_helper"

RSpec.describe SmsMessage do
  describe "validations" do
    it "is valid with the factory" do
      expect(build(:sms_message)).to be_valid
    end

    it "requires a known kind" do
      message = build(:sms_message, kind: "carrier_pigeon")

      expect(message).not_to be_valid
      expect(message.errors[:kind]).to be_present
    end

    it "requires a known status" do
      message = build(:sms_message, status: "probably_fine")

      expect(message).not_to be_valid
      expect(message.errors[:status]).to be_present
    end

    it "defaults to pending, because the sweep claims a reminder before anything is sent" do
      expect(create(:sms_message).status).to eq("pending")
    end

    it "requires days_before on a reminder" do
      message = build(:sms_message, kind: "reminder", days_before: nil)

      expect(message).not_to be_valid
      expect(message.errors[:days_before]).to be_present
    end

    it "rejects a negative days_before" do
      message = build(:sms_message, kind: "reminder", days_before: -1)

      expect(message).not_to be_valid
      expect(message.errors[:days_before]).to be_present
    end

    it "accepts a day-of reminder, which is simply an offset of zero" do
      expect(build(:sms_message, kind: "reminder", days_before: 0)).to be_valid
    end

    it "refuses days_before on a cover notice, which is not one of the shift's reminders" do
      message = build(:sms_message, :cover_notice, days_before: 3)

      expect(message).not_to be_valid
      expect(message.errors[:days_before]).to be_present
    end

    it "requires a unique twilio_sid so a redelivered webhook is unambiguous" do
      create(:sms_message, :sent, twilio_sid: "SM123")
      duplicate = build(:sms_message, :sent, twilio_sid: "SM123")

      expect(duplicate).not_to be_valid
      expect(duplicate.errors[:twilio_sid]).to be_present
    end

    it "allows many messages to be waiting on a SID at once" do
      create(:sms_message, twilio_sid: nil)

      expect(build(:sms_message, twilio_sid: nil)).to be_valid
    end
  end

  # The reason this index exists rather than a `validates_uniqueness_of` is that a validation
  # reads and then writes, so two overlapping sweeps both see "no reminder yet" and both send. A
  # unique index cannot race — the loser gets a constraint violation and skips.
  #
  # So these examples put the model entirely out of the way and prove that POSTGRES refuses the
  # duplicate. A spec that went through SmsMessage.create would only be re-testing the validation
  # we deliberately did not rely on.
  describe "the reminder idempotency index (enforced by Postgres, not by the model)" do
    # A plain INSERT. No model, no validations, no callbacks — exactly what a second sweep
    # running in another process would issue.
    def insert_reminder_directly(shift:, member:, days_before:)
      sql = SmsMessage.sanitize_sql_array([ <<~SQL, shift.id, member.id, days_before ])
        INSERT INTO sms_messages (kind, shift_id, member_id, days_before, status, created_at, updated_at)
        VALUES ('reminder', ?, ?, ?, 'pending', NOW(), NOW())
      SQL

      SmsMessage.connection.execute(sql)
    end

    let(:shift) { create(:shift) }
    let(:member) { shift.assigned_member }

    it "declares a real partial unique index in Postgres" do
      definition = SmsMessage.connection.select_value(<<~SQL)
        SELECT indexdef FROM pg_indexes
        WHERE indexname = 'index_sms_messages_on_reminder_idempotency'
      SQL

      expect(definition).to include("UNIQUE INDEX")
      expect(definition).to include("(shift_id, days_before)")
      expect(definition).to match(/WHERE .*kind.* = 'reminder'/)
    end

    it "refuses a second reminder for the same shift and offset" do
      insert_reminder_directly(shift: shift, member: member, days_before: 3)

      expect {
        insert_reminder_directly(shift: shift, member: member, days_before: 3)
      }.to raise_error(ActiveRecord::RecordNotUnique, /index_sms_messages_on_reminder_idempotency/)
    end

    it "leaves exactly one row behind when two sweeps race for the same reminder" do
      insert_reminder_directly(shift: shift, member: member, days_before: 3)

      # A savepoint, so the losing INSERT rolls back on its own and we can still query afterwards
      # — which is precisely what the real sweep does when it loses the race.
      expect {
        SmsMessage.transaction(requires_new: true) do
          insert_reminder_directly(shift: shift, member: member, days_before: 3)
        end
      }.to raise_error(ActiveRecord::RecordNotUnique)

      expect(SmsMessage.where(shift: shift, kind: "reminder", days_before: 3).count).to eq(1)
    end

    it "still allows the shift's other reminders through" do
      insert_reminder_directly(shift: shift, member: member, days_before: 3)
      insert_reminder_directly(shift: shift, member: member, days_before: 0)

      expect(SmsMessage.where(shift: shift, kind: "reminder").count).to eq(2)
    end

    it "does not constrain cover notices, which a shift may collect any number of" do
      create(:sms_message, :cover_notice, shift: shift, member: member)
      create(:sms_message, :cover_notice, shift: shift, member: member)

      expect(SmsMessage.where(shift: shift, kind: "cover_notice").count).to eq(2)
    end

    it "does not constrain the same offset on a different shift" do
      other_shift = create(:shift)

      insert_reminder_directly(shift: shift, member: member, days_before: 3)
      insert_reminder_directly(
        shift: other_shift, member: other_shift.assigned_member, days_before: 3
      )

      expect(SmsMessage.where(kind: "reminder", days_before: 3).count).to eq(2)
    end

    # Postgres treats NULLs as distinct inside a unique index, so a reminder with no offset would
    # slip past the index above every single time and double-text on every sweep. The check
    # constraint is what closes that hole, and it is not optional.
    it "refuses a reminder with a NULL days_before, which would slip past a unique index" do
      expect {
        SmsMessage.transaction(requires_new: true) do
          insert_reminder_directly(shift: shift, member: member, days_before: nil)
        end
      }.to raise_error(ActiveRecord::StatementInvalid, /sms_messages_reminder_has_days_before/)
    end
  end
end
