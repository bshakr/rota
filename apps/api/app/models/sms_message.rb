# One text, and what became of it.
#
# The reminder sweep does not call Twilio. It inserts a `pending` row — *claiming* that reminder
# via the partial unique index on (shift_id, days_before) — and enqueues a SendSmsJob, which
# renders the template, sends, and records the SID. A signature-validated Twilio status webhook
# later moves the row to `delivered` or `failed`, so "I never got the text" is answerable with a
# carrier status rather than a shrug.
class SmsMessage < ApplicationRecord
  KINDS = { reminder: "reminder", cover_notice: "cover_notice" }.freeze
  STATUSES = { pending: "pending", sent: "sent", delivered: "delivered", failed: "failed" }.freeze

  belongs_to :shift
  belongs_to :member

  enum :kind, KINDS, validate: true
  enum :status, STATUSES, validate: true

  validates :kind, presence: true
  validates :status, presence: true

  # A reminder is *identified* by its offset — it is the second half of the idempotency key that
  # makes double-texting impossible. Postgres treats NULLs as distinct inside a unique index, so a
  # reminder with no offset would slip past that index every single time. The database refuses it
  # too (see the sms_messages_reminder_has_days_before check constraint); this is here to say so
  # in English before it gets that far.
  validates :days_before,
    presence: true,
    numericality: { only_integer: true, greater_than_or_equal_to: 0 },
    if: :reminder?
  # A cover notice is not tied to an offset, and giving it one would silently enter it into the
  # reminder idempotency key's namespace.
  validates :days_before, absence: true, if: :cover_notice?

  validates :twilio_sid, uniqueness: true, allow_nil: true
end
