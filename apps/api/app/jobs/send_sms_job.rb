# Sends one text: the row is already in the database, `pending`, before this job exists.
#
# That ordering is the whole idempotency story. The reminder sweep (BLO-1049) *claims* a reminder by
# inserting the row — the partial unique index on (shift_id, rota_reminder_id) makes a second claim a
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

  # Nine attempts wait about 2.4 hours (up to 2.7 with jitter), long enough to outlast a home
  # internet drop on the server's line. A late reminder is still a reminder; one whose shift's day
  # is over is not, see skip_shift_day_over.
  retry_on Sms::TransientFailure, wait: :polynomially_longer, attempts: 9 do |job, error|
    # Out of retries. A silently failed text is worse than no rota at all: record it, so the SMS log
    # can answer "why didn't Alice get her text" with a carrier code rather than a shrug. A transient
    # failure released the claim back to `pending` before re-raising, so the row is claimable here.
    job.class.record_failure(job.arguments.first, error.error_code)

    # Log and report, never one or the other. Every attempt refused at texting one person is a
    # carrier problem or a bug, and the SMS log only answers it for somebody who already suspects
    # something is wrong. Reported here rather than per attempt (see active_job_report_on_retry_error
    # in config/initializers/sentry.rb): one wobble should not page anybody once per attempt.
    Rails.logger.error(
      "SendSmsJob(#{job.arguments.first}) gave up after #{job.executions} attempts: #{error.class}: #{error.error_code}"
    )
    Rails.error.report(
      error,
      handled: true,
      severity: :warning,
      context: { sms_message_id: job.arguments.first, error_code: error.error_code },
      source: "rotamonster.sms"
    )
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
    # Before the claim, not after, because the row has to be left exactly as it was found — see
    # skip_paused_house.
    return skip_paused_house(message) if message.member.group.suspended?
    # Claim atomically: pending -> sending in a single UPDATE. Zero rows affected means someone else
    # already claimed it, or it has moved past pending (sent, or left `sending` by a crashed run that
    # must never be re-sent). Either way, this run does nothing.
    return unless claim(message)

    # Before every guard: a text that did go out must be recorded as sent, not failed.
    return if message.ambiguous_attempt_at && record_earlier_send(message)

    body = nil
    return skip_uncontactable(message) unless message.member.contactable?

    return skip_shift_day_over(message) if shift_day_over?(message)

    template = message_template(message) unless message.member_login?
    return skip_removed_reminder(message) if message.reminder? && template.nil?

    body = if message.member_login?
      "Your Rota Monster personal link: #{Rails.configuration.x.sms.app_url}/s/#{message.member.access_token}\nKeep this link private. If you didn't request it, ignore this text."
    else
      Sms::Renderer.for_shift(message.shift, template: template, member: message.member)
    end
    attempted_at = Time.current
    delivery = Sms.deliver(to: message.member.phone_e164, body: body)

    # The segment count is written with the SID, in the same statement, because it is the only cost
    # figure that exists at send time — Twilio settles a price minutes later, and BackfillSmsPricesJob
    # is what goes and asks for it. Recording it here means no row ever carries a SID with nothing
    # beside it for the spend page to estimate from (BLO-1672).
    message.update!(
      status: :sent,
      body: body,
      twilio_sid: delivery.sid,
      num_segments: delivery.num_segments,
      sent_at: Time.current
    )
  rescue Sms::AmbiguousFailure
    # Twilio may have the message. Keep what was sent and when, so the retry looks before posting.
    release_claim(body: body, ambiguous_attempt_at: attempted_at)
    raise
  rescue Sms::TransientFailure
    # Twilio did not accept the message, or the lookup could not answer. Release the claim so the
    # retry can re-claim, then re-raise for retry_on's backoff.
    release_claim
    raise
  rescue Sms::PermanentFailure => e
    # A bad number, a blocked recipient, a template we cannot render. Retrying would ask Twilio the
    # same question again and get the same answer.
    self.class.record_failure(sms_message_id, e.error_code, body: body)

    # A template that cannot be rendered should have been refused when the rota was saved. Reaching
    # send time means the model validation has a hole in it, and the house whose reminder this was
    # has just silently not been texted. The other permanent failures are the world being itself (a
    # disconnected number, a recipient who blocked us) and belong in the SMS log, not in an issue.
    if e.error_code == SmsMessage::INVALID_TEMPLATE
      Rails.logger.error("SendSmsJob(#{sms_message_id}) refused an invalid template that was saved anyway")
      Rails.error.report(
        e,
        handled: true,
        severity: :warning,
        context: { sms_message_id: sms_message_id },
        source: "rotamonster.sms.template"
      )
    end
  rescue StandardError => e
    # The catch-all. Anything else — a nil the renderer chokes on, a bug on this path — must not
    # leave the row stranded in `sending` with no status and its retries spent. Record it and move
    # on; "why didn't Alice get her text" stays answerable even when the answer is "we hit a bug".
    Rails.logger.error("SendSmsJob(#{sms_message_id}) unexpected #{e.class}: #{e.message}")
    Rails.error.report(
      e,
      handled: true,
      severity: :error,
      context: { sms_message_id: sms_message_id },
      source: "rotamonster.sms"
    )
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

  # Undo a claim so a retry can take it again. When the send's outcome is unknown, the body and the
  # earliest such attempt are kept, and the retry asks Twilio before posting again.
  def release_claim(body: nil, ambiguous_attempt_at: nil)
    updates = { status: "pending", updated_at: Time.current }
    if ambiguous_attempt_at
      updates[:body] = body
      updates[:ambiguous_attempt_at] = Arel.sql(
        SmsMessage.sanitize_sql([ "COALESCE(ambiguous_attempt_at, ?)", ambiguous_attempt_at ])
      )
    end
    SmsMessage.where(id: @sms_message_id, status: :sending).update_all(updates)
  end

  # True when Twilio already holds the text an earlier attempt may have sent; the row is then
  # recorded as sent from Twilio's copy. SIDs other rows recorded are skipped because a personal
  # link's body is the same every time it is requested.
  def record_earlier_send(message)
    taken = SmsMessage.where.not(id: message.id).where.not(twilio_sid: nil)
      .where(sent_at: (message.ambiguous_attempt_at - 1.hour)..).pluck(:twilio_sid)
    delivery = Sms.find_sent(
      to: message.member.phone_e164, body: message.body, since: message.ambiguous_attempt_at, excluding_sids: taken
    )
    return false if delivery.nil?

    message.update!(status: :sent, twilio_sid: delivery.sid, num_segments: delivery.num_segments, sent_at: Time.current)
    true
  end

  # Inactive, or opted out. The sweep filters for `contactable?` too, but a member can opt out in
  # the minutes between the row being claimed and this job running — and the last word on whether we
  # are allowed to text somebody belongs to the code that does the texting.
  def skip_uncontactable(message)
    message.update!(status: :failed, error_code: SmsMessage::NOT_CONTACTABLE)
  end

  # The admin deleted the reminder after the sweep claimed it. Its text is gone with it, and sending
  # another reminder's text in its place would be a message nobody wrote for this moment.
  def skip_removed_reminder(message)
    message.update!(status: :failed, error_code: SmsMessage::REMINDER_REMOVED)
  end

  # The sweep's own rule for a day-of or earlier reminder, applied again at send time because a
  # retry can outlive the day: "it's your turn today" about yesterday is worse than silence.
  def shift_day_over?(message)
    message.reminder? && message.days_before >= 0 && message.shift.due_on < message.member.group.today
  end

  def skip_shift_day_over(message)
    message.update!(status: :failed, error_code: SmsMessage::SHIFT_DAY_OVER)
  end

  # Nil when the reminder was deleted after this run claimed the row.
  def message_template(message)
    return message.shift.rota.cover_notice_template unless message.reminder?
    return message.rota_reminder&.message_template if message.rota_reminder_id

    legacy_reminder_template(message)
  end

  # A row the previous release claimed mid-deploy, by timing alone: the rota's reminder at that
  # timing (the oldest, if two share it), else the rota's old single template. Never another
  # timing's reminder.
  def legacy_reminder_template(message)
    rota = message.shift.rota
    at_timing = rota.reminders.select { |reminder| reminder.days_before == message.days_before }
    at_timing.min_by(&:id)&.message_template || rota.message_template
  end

  # The house was paused between the sweep claiming this reminder and this job running (BLO-1675).
  # The sweep skips suspended houses, but a reminder already in the queue when the operator pulled
  # the lever would otherwise go out after it — and "suspend" that still texts people is not a
  # suspension.
  #
  # The row is left `pending` and NOT marked failed, which is the deliberate part. `failed` is what
  # the operator's list and the overview count as a delivery incident, and a text nobody tried to
  # send is not one: a house would appear to have started failing on the day it was paused, by us.
  # So the row stays as it was — a reminder that was claimed and never sent — and it is visible as
  # an unsent text rather than as a carrier failure.
  #
  # Nothing re-enqueues it on resume, and that is correct rather than a gap: the reminder stays
  # claimed, so the sweep will not raise a second one for the same (shift, reminder), and its send
  # moment is now in the past, where ReminderSweep's 24-hour staleness guard would have buried it
  # anyway. Resuming a house texts nobody about the days it was paused.
  def skip_paused_house(message)
    Rails.logger.info("SendSmsJob(#{message.id}) skipped: house paused")
  end
end
