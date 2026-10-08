# One text, and what became of it.
#
# The reminder sweep does not call Twilio. It inserts a `pending` row — *claiming* that reminder
# via the partial unique index on (shift_id, rota_reminder_id) — and enqueues a SendSmsJob, which
# renders the template, sends, and records the SID. A signature-validated Twilio status webhook
# later moves the row to `delivered` or `failed`, so "I never got the text" is answerable with a
# carrier status rather than a shrug.
class SmsMessage < ApplicationRecord
  KINDS = { reminder: "reminder", cover_notice: "cover_notice", member_login: "member_login" }.freeze
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
  # REMINDER_REMOVED: the admin deleted the reminder between the claim and the send. Nothing was sent.
  NOT_CONTACTABLE = "not_contactable".freeze
  REMINDER_REMOVED = "reminder_removed".freeze
  INVALID_TEMPLATE = "invalid_template".freeze
  INTERNAL_ERROR = "internal_error".freeze

  belongs_to :shift, optional: true
  validates :shift, presence: true, unless: :member_login?
  validates :shift, absence: true, if: :member_login?
  validates :days_before, absence: true, if: :member_login?
  belongs_to :member
  # Optional: the foreign key nullifies it when the admin deletes the reminder, and the log row stays.
  belongs_to :rota_reminder, optional: true
  validates :rota_reminder, absence: true, unless: :reminder?

  enum :kind, KINDS, validate: true
  enum :status, STATUSES, validate: true

  validates :kind, presence: true
  validates :status, presence: true

  # The timing the reminder had when it was claimed; the SMS log labels the row by it. Negative is
  # after the shift.
  validates :days_before, presence: true, numericality: { only_integer: true }, if: :reminder?
  # A cover notice is not tied to an offset, and giving it one would silently enter it into the
  # reminder idempotency key's namespace.
  validates :days_before, absence: true, if: :cover_notice?

  validates :twilio_sid, uniqueness: true, allow_nil: true

  # Rows that cost money and that nobody has asked Twilio the price of yet (BLO-1672).
  #
  # A SID is the proof Twilio accepted the message; a row without one never left the building and
  # was never charged for. `price_fetched_at` is the "we asked" flag rather than the "we were
  # charged" one — a message Twilio has no record of is marked asked with its price left null — so
  # this scope shrinks with every sweep instead of re-offering the same unanswerable rows forever.
  scope :awaiting_price, -> { where.not(twilio_sid: nil).where(price_fetched_at: nil) }
end
