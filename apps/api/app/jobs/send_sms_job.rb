# Sends one text: the row is already in the database, `pending`, before this job exists.
#
# That ordering is the whole idempotency story. The reminder sweep (BLO-1049) *claims* a reminder by
# inserting the row — the partial unique index on (shift_id, days_before) makes a second claim a
# constraint violation — and only then enqueues this. So a job that runs twice, or two workers
# racing a redeploy, cannot double-text: the second run finds a row that is no longer `pending` and
# does nothing.
class SendSmsJob < ApplicationJob
  queue_as :default

  # Twilio wobbles are worth waiting out. Five attempts over a few minutes; a reminder that lands
  # late is still a reminder, and Solid Queue is doing the waiting, not a worker thread.
  retry_on Sms::TransientFailure, wait: :polynomially_longer, attempts: 5 do |job, error|
    # Out of retries. A silently failed text is worse than no rota at all: record it, so the SMS log
    # can answer "why didn't Alice get her text" with a carrier code rather than a shrug.
    job.class.record_failure(job.arguments.first, error)
  end

  def self.record_failure(sms_message_id, error, body: nil)
    message = SmsMessage.find_by(id: sms_message_id)
    return if message.nil? || !message.pending?

    message.update!(status: :failed, error_code: error.error_code, body: body || message.body)
  end

  def perform(sms_message_id)
    message = SmsMessage.find_by(id: sms_message_id)
    return if message.nil?
    # Anything but `pending` means this text has already been sent, or already failed for good. A
    # retry of a job whose send succeeded but whose bookkeeping did not must not send a second time.
    return unless message.pending?

    body = nil
    return skip_uncontactable(message) unless message.member.contactable?

    body = Sms::Renderer.for_shift(message.shift, member: message.member)
    delivery = Sms.deliver(to: message.member.phone_e164, body: body)

    message.update!(
      status: :sent,
      body: body,
      twilio_sid: delivery.sid,
      sent_at: Time.current
    )
  rescue Sms::PermanentFailure => e
    # A bad number, a blocked recipient, a template we cannot render. Retrying would ask Twilio the
    # same question five times and get the same answer.
    self.class.record_failure(sms_message_id, e, body: body)
  end

  private

  # Inactive, or opted out. The sweep filters for `contactable?` too, but a member can opt out in
  # the minutes between the row being claimed and this job running — and the last word on whether we
  # are allowed to text somebody belongs to the code that does the texting.
  def skip_uncontactable(message)
    message.update!(status: :failed, error_code: SmsMessage::NOT_CONTACTABLE)
  end
end
