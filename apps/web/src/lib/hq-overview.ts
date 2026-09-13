import type { AttentionReason, FunnelStep, JobName } from "./api/super-admin-overview";

/**
 * The words and the judgement behind the operator's overview page.
 *
 * "HQ" is what the product calls this area — the peach sticker in the shell's
 * plum band, and the page's own title — so this is HQ's overview, told apart
 * from `./api/super-admin-overview`, which is the payload's SHAPE. Shape there,
 * meaning here.
 *
 * Everything in this module is pure and takes its clock as an argument, for the
 * same reason `lib/date.ts` does: a `Date.now()` inside a component renders one
 * string on the server and another in the browser a moment later, which is a
 * hydration mismatch on a page made almost entirely of elapsed times.
 *
 * It exists at all because this is the page where a wrong word is a wrong
 * decision. "0 failures" and "we could not ask" must not look alike, a rate must
 * never be rounded to a whole percent, and "50 houses need a look" must not be
 * shown when three hundred do. Each of those is a sentence, and each is tested.
 */

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

// --- Rates ------------------------------------------------------------------

/**
 * A percentage at ONE DECIMAL, always — "96.4%", and "100.0%" rather than
 * "100%".
 *
 * Never a whole percent. The API computes the rate to a tenth (96.4 is what the
 * data supports), and rounding it to 96 on the way to the screen throws away
 * precision the operator is entitled to; a trailing ".0" is the cost of never
 * having to wonder whether a figure was rounded. Project rule, BLO-1454.
 */
export function formatRate(rate: number): string {
  return `${rate.toFixed(1)}%`;
}

/**
 * The delivery rate WITH its denominator: "96.4% of 412 settled".
 *
 * The denominator is not decoration. 96.4% of twelve texts and 96.4% of four
 * hundred are different facts, and a rate on its own lets an operator act on the
 * first as if it were the second.
 *
 * Null rate is "nothing has settled yet", which is the opposite of "none of them
 * arrived" — so it gets words, never 0%.
 */
export function deliveryRateNote(rate: number | null, settled: number): string {
  if (rate === null) return "no texts settled yet";
  return `${formatRate(rate)} of ${settled} settled`;
}

// --- Capped lists -----------------------------------------------------------

/**
 * "Showing 50 of 312" when a list is capped, and nothing at all when it is not.
 *
 * The attention list is capped at 50 by the API. A page that renders fifty rows
 * and says nothing implies fifty is all there is, which is how a bad week across
 * three hundred houses becomes invisible.
 */
export function showingOf(shown: number, total: number): string | null {
  if (total <= shown) return null;
  return `Showing ${shown} of ${total}`;
}

// --- The attention list -----------------------------------------------------

/** Badge variants, so a caller cannot invent a tone the design system has not got. */
export type AttentionTone = "destructive" | "warning" | "info" | "secondary";

/**
 * The pill on an attention row: what kind of trouble, at a glance.
 *
 * Semantic colour, never the accent — the accent is a hover tint, and a row that
 * looks hovered is not a row that looks wrong. Failing texts wear `destructive`
 * (the blush "went wrong" sticker) because they are the one reason that always
 * costs a real person their reminder; the rest are quieter in proportion to how
 * long they can be left.
 */
export const ATTENTION_PILL: Record<AttentionReason, { label: string; tone: AttentionTone }> = {
  failed_texts: { label: "Texts failing", tone: "destructive" },
  unconfirmed_timezone: { label: "Timezone unconfirmed", tone: "warning" },
  only_draft_rotas: { label: "Nobody on the rota", tone: "info" },
  opted_out_member: { label: "Housemate opted out", tone: "secondary" },
};

/**
 * Why this house is on the list, in the house voice — what went wrong and what
 * it costs, not the name of a database condition.
 */
export function attentionSentence(reason: AttentionReason, count: number | null): string {
  const n = count ?? 0;

  switch (reason) {
    case "failed_texts":
      return `${n} ${plural(n, "text", "texts")} didn't arrive this week.`;
    case "unconfirmed_timezone":
      return "Nobody has confirmed the timezone, so every reminder may go out an hour off.";
    case "only_draft_rotas":
      return `${n} ${plural(n, "rota has", "rotas have")} nobody on ${plural(n, "it", "them")}, so ${plural(n, "it sends", "they send")} nothing.`;
    case "opted_out_member":
      return `${n} ${plural(n, "housemate", "housemates")} replied STOP but ${plural(n, "is", "are")} still on a rota.`;
  }
}

// --- The onboarding ladder --------------------------------------------------

/**
 * The plan's funnel is eight steps. The query can derive six of them, and the
 * page numbers them 3 to 8 rather than renumbering the ladder — see
 * UNTRACKED_LEADING_STEPS.
 */
export const PLAN_FUNNEL_STEPS = 8;

/**
 * Steps 1 (landing views) and 2 (signed in) need the `page_views` table that is
 * Phase 5 and a `sign_ins` join the overview query does not make. They are not
 * tracked, and the page says so — calling `made_house` "step 1" would quietly
 * redefine the funnel everyone else is reading.
 */
export const UNTRACKED_LEADING_STEPS = 2;

/** A house's rung, numbered as the PLAN numbers it: rung 1 of six is step 3 of 8. */
export function planStepNumber(furthestStepNumber: number): number {
  return furthestStepNumber + UNTRACKED_LEADING_STEPS;
}

/** "Step 5 of 8" — the caption under a house's pips. */
export function stepCaption(furthestStepNumber: number): string {
  return `Step ${planStepNumber(furthestStepNumber)} of ${PLAN_FUNNEL_STEPS}`;
}

/** What each rung means, in the product's words rather than the column's. */
export const FUNNEL_STEP_LABELS: Record<FunnelStep, string> = {
  made_house: "Made a house",
  confirmed_timezone: "Confirmed the timezone",
  added_member: "Added a housemate",
  started_rota: "Put people on a rota",
  delivered_text: "A reminder arrived",
  first_cover: "Somebody covered a turn",
};

// --- System health ----------------------------------------------------------

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

/** Friendly names for the three recurring jobs. The keys are recurring.yml's. */
export const JOB_LABELS: Record<JobName, string> = {
  reminder_sweep: "Reminder sweep",
  top_up_shift_windows: "Shift top-up",
  sync_house_calendars: "Calendar sync",
};

/**
 * How often each job is scheduled, read off `apps/api/config/recurring.yml`:
 *
 *   reminder_sweep        every hour
 *   top_up_shift_windows  every day at 3am
 *   sync_house_calendars  every hour at minute 27
 *
 * These are the numbers "is it stale?" is measured against, so they have to
 * match the schedule file. Change one there and change it here.
 */
export const JOB_CADENCE_MS: Record<JobName, number> = {
  reminder_sweep: HOUR_MS,
  top_up_shift_windows: DAY_MS,
  sync_house_calendars: HOUR_MS,
};

/** The cadence in words, so a stale marker can be read without knowing the schedule. */
export const JOB_CADENCE_LABELS: Record<JobName, string> = {
  reminder_sweep: "hourly",
  top_up_shift_windows: "daily, 3am UTC",
  sync_house_calendars: "hourly, 27 past",
};

/**
 * The slack a job gets past its cadence before the page calls it stale.
 *
 * A run takes time, the scheduler fires on the minute and the row is written when
 * the pass ENDS, so the gap between two finishes is always a little over the
 * cadence. Without a grace the hourly jobs would flash stale for a few seconds
 * every hour, and a marker that cries wolf is a marker nobody reads.
 */
export const STALE_GRACE_MS = 15 * MINUTE_MS;

/**
 * Has this job missed its slot?
 *
 * Never finished at all is stale by definition — for something scheduled hourly
 * it is the loudest thing the tile can say, and it must not read as "fine" just
 * because there is no timestamp to compare.
 */
export function isJobStale(lastFinishedAt: Date | null, job: JobName, now: Date): boolean {
  if (lastFinishedAt === null) return true;
  return now.getTime() - lastFinishedAt.getTime() > JOB_CADENCE_MS[job] + STALE_GRACE_MS;
}

/**
 * The queue's failed executions, as a sentence.
 *
 * Null is "we could not ask" — Solid Queue keeps its tables in a separate
 * database, and the API reports null rather than failing the whole payload when
 * that read falls over. Rendering it as 0 would turn an outage into an all-clear.
 */
export function queueFailuresNote(failed: number | null): string {
  if (failed === null) return "Queue unreachable — failures unknown";
  if (failed === 0) return "No failed jobs in the queue";
  return `${failed} failed ${plural(failed, "job", "jobs")} in the queue`;
}
