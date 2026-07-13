# Tells the people whose turn just changed, each via their own magic link.
#
# It does NOT call Twilio. Exactly like the reminder sweep, it inserts a `pending` sms_messages row —
# here kind `cover_notice` — and enqueues a SendSmsJob, which renders the rota's template for that
# member (appending their own magic link) and records the result (BLO-1046). Keeping this on the same
# path means a cover notice gets the same retries, the same idempotent claim, and the same SMS log
# entry as every other text the system sends.
#
# A cover notice carries no `days_before`: it is not one of the shift's scheduled reminders, so it
# stays out of the (shift_id, days_before) reminder idempotency index and a shift can be handed on as
# many times as plans change.
class CoverNotice
  def self.deliver(shift:, to:)
    # Narrow to who we are actually allowed to text. The cover target is contactable by the time it
    # gets here, but a party who is merely being relieved of a shift might since have opted out.
    Array(to).select(&:contactable?).each do |member|
      message = shift.sms_messages.create!(kind: :cover_notice, member: member, status: :pending)
      SendSmsJob.perform_later(message.id)
    end
  end
end
