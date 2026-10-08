# Reminders are records, each with its own message and a signed day timing

- Status: proposed
- Date: 2026-10-08
- Ticket: [BLO-1948](https://linear.app/bloombase/issue/BLO-1948)

## Context

A rota sends every reminder with one message. Timing lives in `rotas.reminder_offsets` (an integer array) and the text in `rotas.message_template`, so "3 days before" and "on the day" cannot say different things, and nothing can be sent after a shift.

The original [design spec](../superpowers/specs/2026-07-13-rotamonster-design.md) (Decisions table, "Reminder timing") chose a list of day-offsets with day-of as offset `0`, and made the partial unique index on `sms_messages (shift_id, days_before) WHERE kind = 'reminder'` the idempotency key. The current code enforces that shape in three places:

- `apps/api/app/models/rota.rb` rejects any offset below zero ("must all be zero or more days before the shift").
- `apps/api/db/schema.rb` has the check `sms_messages_days_before_non_negative` (`days_before IS NULL OR days_before >= 0`) and the unique index `index_sms_messages_on_reminder_idempotency`.
- `apps/api/app/services/reminder_sweep.rb` only considers shifts due from the group's today onwards, so a past shift is never texted, and a 24 hour staleness guard (`STALE_AFTER`) stops an overdue moment from firing late.

Keying idempotency on `days_before` also means that once a reminder has its own message, two messages on the same day would collide, and editing a reminder's timing would let it text a shift again.

## Decision

- Reminders are rows in a new `rota_reminders` table: `rota_id`, `days_before`, `message_template`. A rota has 0 to 10 of them.
- `days_before` is one signed integer: positive is N days before the shift day, `0` is on the day, negative is N days after (`-1` is the next day). A check constraint holds it to -14..365. The `days_before >= 0` check on `sms_messages` is dropped; reminder rows still carry `days_before`, copied from the reminder, for the SMS log.
- A reminder's identity is `(shift, reminder)`: `sms_messages.rota_reminder_id` replaces `days_before` in the partial unique index. Editing a reminder keeps its identity, so a shift it already texted is not texted again by it. Removing a reminder and adding a new one creates a new identity.
- The same timing may appear more than once on a rota.
- The send time stays the rota-level `send_hour`, in the group's time zone, for every reminder.
- The recipient is still the shift's responsible member resolved at send time, so an after-shift reminder goes to whoever did the shift.
- The sweep's candidate window widens to cover the smallest and largest `days_before`, with the same 24 hour staleness guard, so adding an after-shift reminder never back-fires for old shifts.
- `rotas.reminder_offsets` and `rotas.message_template` stay as columns for one release (backfilled into `rota_reminders` by the migration, no longer read for sending), then are dropped.

## Consequences

- Easier: per-reminder wording, after-shift texts, and two texts on the same day, all on the existing sweep and its database-enforced idempotency.
- Harder: a rota's reminders are a child collection, so create and update take a full replacement list and validation errors are per row. A rota now loads a second table to sweep.
- A shift can produce texts after it has become history. The rule "a shift that has come due is never texted about", stated in the sweep's comments, no longer holds for negative timings and must be rewritten where it is relied on.
- A pending reminder row whose reminder was deleted has no template; it is not sent, and never falls back to another template.
- We owe a follow-up to drop `rotas.reminder_offsets` and `rotas.message_template`, and the back-compat mapping of `reminder_offsets` in requests, after one release.

## Alternatives considered

- **Parallel arrays on `rotas` (`offsets[]` plus `templates[]`).** Lost because an array position is not a stable identity: reordering or removing one entry silently re-keys every later message, so idempotency could not survive an edit.
- **A separate after-shift "follow-up" feature.** Lost because it duplicates the sweep, the claim index, the template rendering and the editor for what is the same thing at a different day.
- **A direction enum plus unsigned days.** Lost because "0 days after" and "0 days before" are the same moment with two spellings, and the sweep's `due_on - days_before` arithmetic already works with a signed integer.
- **A per-reminder send hour now.** Lost because this ticket does not need it, and it can be added later as a nullable column defaulting to the rota's `send_hour` without changing this decision.
