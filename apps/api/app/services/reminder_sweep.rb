# Reconciles one rota's reminders: "what reminders should have gone out by now, and haven't?"
#
# This is the app's most important job, and it is deliberately NOT a trigger. A trigger fires at
# `send_hour` and texts whoever is due, which silently drops a reminder whenever the worker is down
# on the hour, a deploy lands on the hour, or the clocks skip the hour in spring. Instead this asks a
# declarative question every hour (ReminderSweepJob) and answers it by comparing each shift's
# scheduled send moment against the sms_messages already on record.
#
# For a MULTI-DAY reminder (offset ≥ 1) an outage becomes a late text, never a lost one: it stays
# deliverable for the full 24 hours of the staleness window. The DAY-OF reminder (offset 0) is
# best-effort within its own calendar day — see #candidate_shifts. "It's your turn today" that heals
# across midnight would be a lie, so once the shift's day is over the day-of reminder is dropped, not
# sent late. A late `send_hour` therefore shrinks the day-of heal window to `send_hour → midnight`.
#
# It does not call Twilio. For each reminder that is due and unclaimed it INSERTS a `pending`
# sms_messages row — which *claims* that reminder through the partial unique index on
# (shift_id, days_before) — and enqueues a SendSmsJob. That ordering is the whole idempotency story:
# two sweeps racing on the same reminder both try to insert, and the database lets exactly one win.
class ReminderSweep
  # A reminder whose moment passed more than this ago stays buried. Without it, adding a 7-day
  # offset to a rota whose next shift is two days out would immediately fire a "7 days to go!" about
  # a shift that is nearly here — the send moment is five days in the past, and reconciliation with
  # no floor would treat every one of those historic moments as overdue. Short outages heal; stale
  # reminders do not resurrect.
  STALE_AFTER = 24.hours

  def initialize(rota)
    @rota = rota
    @group = rota.group
  end

  def call
    return if rota.reminder_offsets.empty?

    # One clock per sweep. `now` and the group's `today` are read from the same instant, so a sweep
    # firing microseconds either side of local midnight cannot land the window test and the candidate
    # bound on opposite days — which would either drop a live reminder or resurrect a past one.
    now = Time.current
    today = now.in_time_zone(group.time_zone).to_date
    shifts = candidate_shifts(today)
    return if shifts.empty?

    already = claimed_reminders(shifts)

    shifts.each do |shift|
      rota.reminder_offsets.each do |days_before|
        next if already.include?([ shift.id, days_before ])
        next unless due?(shift, days_before, now)

        dispatch(shift, days_before)
      end
    end
  end

  private

  attr_reader :rota, :group

  # Only shifts whose reminders could plausibly be live right now. A reminder for offset d fires at
  # `due_on - d`, and a moment more than a day old is stale, so a shift due further out than the
  # furthest offset (plus a day of slack for send_hour and timezone) cannot have a live reminder.
  #
  # The lower bound is the group's own today, and it does double duty as the "never for a past shift"
  # guarantee: a shift that has already come due is history and is never texted about. For a
  # multi-day reminder this is invisible — its moment goes stale (`> 24h` old) before the shift falls
  # out of the window, so staleness, not this bound, is what retires it. For the DAY-OF reminder the
  # two lines differ: this bound retires it at local midnight, which can be sooner than 24h. That is
  # deliberate (a day-of reminder about a day already over is worse than silence), and it means a
  # late `send_hour` leaves the day-of reminder only `send_hour → midnight` to heal in.
  def candidate_shifts(today)
    horizon = today + rota.reminder_offsets.max + 1
    rota.shifts
      .where(due_on: today..horizon)
      .includes(:assigned_member, :covering_member)
      .to_a
  end

  # The (shift_id, days_before) pairs that already have a reminder row — claimed, whatever their send
  # status. Read once per sweep so the common case (a reminder sent hours ago, still inside the
  # 24-hour window, seen again on the next hourly pass) is a set lookup rather than a doomed INSERT.
  def claimed_reminders(shifts)
    SmsMessage.reminder
      .where(shift_id: shifts.map(&:id))
      .pluck(:shift_id, :days_before)
      .to_set
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
  def dispatch(shift, days_before)
    recipient = shift.responsible_member
    # Inactive or opted out: create no row, so the reminder stays unclaimed and can still go out on a
    # later pass if they are re-included while the shift is still in the future. SendSmsJob re-checks
    # this too, for the member who opts out in the gap between claim and send.
    return unless recipient.contactable?

    message = SmsMessage.create!(
      shift: shift,
      member: recipient,
      kind: :reminder,
      days_before: days_before,
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
