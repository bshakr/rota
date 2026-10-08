# Reconciles one rota's reminders: "what reminders should have gone out by now, and haven't?"
#
# This is the app's most important job, and it is deliberately NOT a trigger. A trigger fires at
# `send_hour` and texts whoever is due, which silently drops a reminder whenever the worker is down
# on the hour, a deploy lands on the hour, or the clocks skip the hour in spring. Instead this asks a
# declarative question every hour (ReminderSweepJob) and answers it by comparing each shift's
# scheduled send moment against the sms_messages already on record.
#
# For any reminder other than the day-of one an outage becomes a late text, never a lost one: it
# stays deliverable for the full 24 hours of the staleness window. The DAY-OF reminder (0) is
# best-effort within its own calendar day — see #candidate_shifts. "It's your turn today" that heals
# across midnight would be a lie, so once the shift's day is over the day-of reminder is dropped, not
# sent late. A late `send_hour` therefore shrinks the day-of heal window to `send_hour → midnight`.
#
# It does not call Twilio. For each reminder that is due and unclaimed it INSERTS a `pending`
# sms_messages row — which *claims* that reminder through the partial unique index on
# (shift_id, rota_reminder_id) — and enqueues a SendSmsJob. That ordering is the whole idempotency
# story: two sweeps racing on the same reminder both try to insert, and the database lets exactly one win.
class ReminderSweep
  # A reminder whose moment passed more than this ago stays buried. Without it, adding a 7-day
  # reminder to a rota whose next shift is two days out would immediately fire a "7 days to go!"
  # about a shift that is nearly here — the send moment is five days in the past, and reconciliation with
  # no floor would treat every one of those historic moments as overdue. Short outages heal; stale
  # reminders do not resurrect.
  STALE_AFTER = 24.hours

  def initialize(rota)
    @rota = rota
    @group = rota.group
  end

  def call
    reminders = rota.reminders.to_a
    return if reminders.empty?

    # One clock per sweep. `now` and the group's `today` are read from the same instant, so a sweep
    # firing microseconds either side of local midnight cannot land the window test and the candidate
    # bound on opposite days — which would either drop a live reminder or resurrect a past one.
    now = Time.current
    today = now.in_time_zone(group.time_zone).to_date
    shifts = candidate_shifts(today, reminders)
    return if shifts.empty?

    claimed = claimed_reminders(shifts)

    shifts.each do |shift|
      reminders.each do |reminder|
        next if claimed.include?([ shift.id, reminder.id ])
        next if claimed.include?([ shift.id, :removed, reminder.days_before ])
        next if reminder.days_before >= 0 && shift.due_on < today
        next unless due?(shift, reminder.days_before, now)

        dispatch(shift, reminder)
      end
    end
  end

  private

  attr_reader :rota, :group

  # Only shifts whose reminders could plausibly be live right now. A reminder for timing d fires at
  # `due_on - d`, and a moment more than a day old is stale, so the window is the furthest timings
  # either side plus a day of slack for send_hour and timezone.
  #
  # A before or day-of reminder (d >= 0) is never sent once the shift's own day is over (see #call):
  # for the day-of reminder that is sooner than staleness, deliberately, because "it's your turn
  # today" about a day already gone is worse than silence. An after-shift reminder (d < 0) is only
  # bounded by staleness, which is also what stops a newly added one back-firing for old shifts.
  def candidate_shifts(today, reminders)
    timings = reminders.map(&:days_before)
    rota.shifts
      .where(due_on: (today + timings.min - 1)..(today + timings.max + 1))
      .includes(:assigned_member, :covering_member)
      .to_a
  end

  # What each shift has already been sent, read once per sweep so the common case is a set lookup
  # rather than a doomed INSERT. A row whose reminder no longer exists (deleted by the admin, or
  # written by the previous release mid-deploy) still claims its timing for that shift: a reminder
  # recreated at the same timing does not text the same shift twice.
  def claimed_reminders(shifts)
    SmsMessage.reminder
      .where(shift_id: shifts.map(&:id))
      .pluck(:shift_id, :rota_reminder_id, :days_before)
      .to_set do |shift_id, reminder_id, days_before|
        reminder_id ? [ shift_id, reminder_id ] : [ shift_id, :removed, days_before ]
      end
  end

  # In the window `[now - 24h, now]`: the moment has arrived, and it is not yet stale. The lower
  # bound is inclusive because the guard buries a reminder only once it is *more than* 24h overdue —
  # a moment exactly 24h old is the last one that still sends.
  def due?(shift, days_before, now)
    moment = send_moment(shift, days_before)
    moment <= now && moment >= now - STALE_AFTER
  end

  # `due_on - days_before` at `send_hour`, read on the GROUP's wall clock. Group#time_zone is a real
  # ActiveSupport::TimeZone, so `local` resolves DST for free: a spring-forward hour that never
  # existed shifts forward to a real instant (the reminder still sends), and a fall-back hour that
  # happens twice resolves to one deterministic instant (both sweeps agree, so the index dedupes).
  def send_moment(shift, days_before)
    send_date = shift.due_on - days_before
    group.time_zone.local(send_date.year, send_date.month, send_date.day, rota.send_hour)
  end

  # Claim the reminder, then enqueue the send. The recipient is resolved here, at send time, so a
  # handover needs no reminder rescheduled: whoever is responsible the moment the sweep runs is who
  # gets the text.
  def dispatch(shift, reminder)
    recipient = shift.responsible_member
    # Inactive or opted out: create no row, so the reminder stays unclaimed and can still go out on a
    # later pass if they are re-included in time. SendSmsJob re-checks this too, for the member who
    # opts out in the gap between claim and send.
    return unless recipient.contactable?

    message = SmsMessage.create!(
      shift: shift,
      member: recipient,
      kind: :reminder,
      rota_reminder: reminder,
      days_before: reminder.days_before,
      status: :pending
    )
    SendSmsJob.perform_later(message.id)
  rescue ActiveRecord::RecordNotUnique
    # A concurrent sweep claimed this exact reminder between our read of claimed_reminders and this
    # INSERT. The partial unique index turned the collision into this exception; the winner has
    # already enqueued the send, so losing the race is a no-op, not a failure.
    nil
  end
end
