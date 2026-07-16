# Tells the people whose turn just changed, each via their own magic link.
#
# It does NOT call Twilio. Exactly like the reminder sweep, it lays down a `pending` sms_messages row —
# here kind `cover_notice` — and enqueues a SendSmsJob, which renders the rota's template for that
# member (appending their own magic link) and records the result (BLO-1046). Keeping this on the same
# path means a cover notice gets the same retries, the same idempotent claim, and the same SMS log
# entry as every other text the system sends.
#
# `record` and `enqueue` are split so ShiftCover can create the rows INSIDE the locked transaction —
# atomic with the cover change, so a change that rolls back or a shift regeneration deletes leaves no
# stranded row — and the caller enqueues the jobs only after it commits. A cover notice carries no
# `days_before`: it is not one of the shift's scheduled reminders, so it stays out of the
# (shift_id, days_before) reminder idempotency index and a shift can be handed on as many times as
# plans change.
class CoverNotice
  # Records a pending cover_notice per recipient we are actually allowed to text, and returns the new
  # message ids. The cover target is contactable by the time it gets here, but a party merely being
  # relieved of a shift might since have opted out.
  def self.record(shift:, to:)
    Array(to).select(&:contactable?).map do |member|
      shift.sms_messages.create!(kind: :cover_notice, member: member, status: :pending).id
    end
  end

  def self.enqueue(message_ids)
    Array(message_ids).each { |id| SendSmsJob.perform_later(id) }
  end
end
