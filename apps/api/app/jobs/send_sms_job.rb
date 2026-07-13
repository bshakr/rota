# Sends one text: the row is already in the database, `pending`, before this job exists.
#
# That ordering is the whole idempotency story. The reminder sweep (BLO-1049) *claims* a reminder by
# inserting the row — the partial unique index on (shift_id, days_before) makes a second claim a
# constraint violation — and only then enqueues this.
#
# Within the job, a second layer of claiming defends the money. Sending is three steps that cannot
# be made one transaction, because the middle step leaves the machine: claim the row, call Twilio,
# record the result. If the process dies between the carrier accepting the message and the row being
# recorded — a redeploy, an OOM, a SIGKILL — Solid Queue re-runs the job, and a naive `pending`
# check would pass again and send a second, unrecallable text. So the claim moves the row
# pending -> sending in ONE atomic UPDATE before Twilio is called; a crash leaves it `sending`,
# never `pending`, and the re-run cannot claim it. A `sending` row is a "needs investigation" state,
# which is strictly better than a duplicate SMS.
class SendSmsJob < ApplicationJob
  queue_as :default

  # Twilio wobbles are worth waiting out. Five attempts over a few minutes; a reminder that lands
  # late is still a reminder, and Solid Queue is doing the waiting, not a worker thread.
  retry_on Sms::TransientFailure, wait: :polynomially_longer, attempts: 5 do |job, error|
    # Out of retries. A silently failed text is worse than no rota at all: record it, so the SMS log
    # can answer "why didn't Alice get her text" with a carrier code rather than a shrug. A transient
    # failure released the claim back to `pending` before re-raising, so the row is claimable here.
    job.class.record_failure(job.arguments.first, error.error_code)
  end

  # Records a terminal failure without ever raising itself: the last thing the failure path should do
  # is fail. Moves whatever non-terminal row it finds to `failed`; a row already moved on (sent,
  # delivered, or failed by another path) is left alone.
  def self.record_failure(sms_message_id, error_code, body: nil)
    message = SmsMessage.find_by(id: sms_message_id)
    return if message.nil? || message.sent? || message.delivered? || message.failed?

    message.update!(status: :failed, error_code: error_code, body: body || message.body)
  rescue StandardError => e
    Rails.logger.error("SendSmsJob#record_failure could not record #{sms_message_id}: #{e.class}: #{e.message}")
  end

  def perform(sms_message_id)
    @sms_message_id = sms_message_id
    message = SmsMessage.find_by(id: sms_message_id)
    return if message.nil?
    # Claim atomically: pending -> sending in a single UPDATE. Zero rows affected means someone else
    # already claimed it, or it has moved past pending (sent, or left `sending` by a crashed run that
    # must never be re-sent). Either way, this run does nothing.
    return unless claim(message)

    body = nil
    return skip_uncontactable(message) unless message.member.contactable?

    body = Sms::Renderer.for_shift(message.shift, member: message.member)
    delivery = Sms.deliver(to: message.member.phone_e164, body: body)

    message.update!(status: :sent, body: body, twilio_sid: delivery.sid, sent_at: Time.current)
  rescue Sms::TransientFailure
    # Twilio did not accept the message, so nothing was sent. Release the claim so the retry can
    # re-claim, then re-raise for retry_on's backoff.
    release_claim
    raise
  rescue Sms::PermanentFailure => e
    # A bad number, a blocked recipient, a template we cannot render. Retrying would ask Twilio the
    # same question five times and get the same answer.
    self.class.record_failure(sms_message_id, e.error_code, body: body)
  rescue StandardError => e
    # The catch-all. Anything else — a nil the renderer chokes on, a bug on this path — must not
    # leave the row stranded in `sending` with no status and its retries spent. Record it and move
    # on; "why didn't Alice get her text" stays answerable even when the answer is "we hit a bug".
    Rails.logger.error("SendSmsJob(#{sms_message_id}) unexpected #{e.class}: #{e.message}")
    self.class.record_failure(sms_message_id, SmsMessage::INTERNAL_ERROR, body: body)
  end

  private

  # One atomic UPDATE ... WHERE status = 'pending'. Returns true only for the caller that flipped it,
  # so exactly one run ever proceeds to Twilio.
  def claim(message)
    claimed = SmsMessage.where(id: message.id, status: :pending)
      .update_all(status: "sending", updated_at: Time.current)
    return false if claimed.zero?

    message.reload
    true
  end

  # Undo a claim so a retry can take it again. Only ever called when no text was sent (a transient
  # Twilio failure), so releasing it cannot cause a double-send.
  def release_claim
    SmsMessage.where(id: @sms_message_id, status: :sending)
      .update_all(status: "pending", updated_at: Time.current)
  end

  # Inactive, or opted out. The sweep filters for `contactable?` too, but a member can opt out in
  # the minutes between the row being claimed and this job running — and the last word on whether we
  # are allowed to text somebody belongs to the code that does the texting.
  def skip_uncontactable(message)
    message.update!(status: :failed, error_code: SmsMessage::NOT_CONTACTABLE)
  end
end
