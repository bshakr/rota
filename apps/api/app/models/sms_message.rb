# One text, and what became of it.
#
# The reminder sweep does not call Twilio. It inserts a `pending` row — *claiming* that reminder
# via the partial unique index on (shift_id, days_before) — and enqueues a SendSmsJob, which
# renders the template, sends, and records the SID. A signature-validated Twilio status webhook
# later moves the row to `delivered` or `failed`, so "I never got the text" is answerable with a
# carrier status rather than a shrug.
class SmsMessage < ApplicationRecord
  KINDS = { reminder: "reminder", cover_notice: "cover_notice" }.freeze
  # `sending` is the claimed-but-not-yet-confirmed waypoint. SendSmsJob moves a row pending ->
  # sending in one atomic UPDATE before it calls Twilio, and sending -> sent only once the carrier
  # has accepted the message. A crash in between leaves the row `sending`, never `pending`, so it
  # is never re-sent — see SendSmsJob and the AddSendingStatusToSmsMessages migration.
  STATUSES = {
    pending: "pending", sending: "sending", sent: "sent", delivered: "delivered", failed: "failed"
  }.freeze

  # Not every failure comes from a carrier. These share the `error_code` column with Twilio's
  # numeric codes (21610, 30006 and friends) so that the SMS log has one column to read and one
  # question to answer — "why didn't Alice get her text" — and they are word-shaped precisely so
  # they can never collide with a Twilio code.
  #
  # NOT_CONTACTABLE: the member was inactive or had opted out when the job ran. Nothing was sent.
  # INVALID_TEMPLATE: the rota's template carried a placeholder we have no value for, or a stray brace.
  # INTERNAL_ERROR: an unexpected exception on the send path (not the carrier's doing).
  NOT_CONTACTABLE = "not_contactable".freeze
  INVALID_TEMPLATE = "invalid_template".freeze
  INTERNAL_ERROR = "internal_error".freeze

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
