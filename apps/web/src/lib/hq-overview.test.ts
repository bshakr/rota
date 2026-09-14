import { describe, expect, it } from "vitest";

import {
  ATTENTION_PILL,
  FUNNEL_STEP_LABELS,
  JOB_CADENCE_MS,
  JOB_LABELS,
  PLAN_FUNNEL_STEPS,
  STALE_GRACE_MS,
  STALE_GRACE_SHARE,
  attentionSentence,
  deliveryRateNote,
  formatRate,
  isJobStale,
  planStepNumber,
  plural,
  queueFailuresNote,
  showingOf,
  staleAfterMs,
  stepCaption,
} from "./hq-overview";
import { ATTENTION_REASONS, FUNNEL_STEPS, JOB_NAMES } from "./api/super-admin-overview";

const NOW = new Date("2026-09-13T09:12:04.000Z");
const ago = (ms: number) => new Date(NOW.getTime() - ms);
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

describe("formatRate", () => {
  it("renders one decimal, never a whole percent", () => {
    expect(formatRate(96.4)).toBe("96.4%");
    expect(formatRate(6.7)).toBe("6.7%");
  });

  // The rule this whole helper exists for: 100 must not render as "100%", or a
  // reader cannot tell a figure that was computed to a tenth from one that was
  // rounded on the way to the screen.
  it("keeps the tenth even when it is zero", () => {
    expect(formatRate(100)).toBe("100.0%");
    expect(formatRate(0)).toBe("0.0%");
    expect(formatRate(96)).toBe("96.0%");
  });

  it("never rounds a tenth away", () => {
    expect(formatRate(96.45)).not.toBe("96%");
    expect(formatRate(99.94)).toBe("99.9%");
  });
});

describe("deliveryRateNote", () => {
  it("publishes the rate with its denominator", () => {
    expect(deliveryRateNote(96.4, 412)).toBe("96.4% of 412 settled");
  });

  // "Nothing has settled" and "none of them arrived" are opposite facts.
  it("says so in words when nothing has settled", () => {
    expect(deliveryRateNote(null, 0)).toBe("no texts settled yet");
  });

  it("renders a genuine zero rate as a rate, not as absence", () => {
    expect(deliveryRateNote(0, 9)).toBe("0.0% of 9 settled");
  });
});

describe("showingOf", () => {
  it("says how much of the list is on screen when it is capped", () => {
    expect(showingOf(50, 312)).toBe("Showing 50 of 312");
  });

  it("says nothing when every row is shown", () => {
    expect(showingOf(12, 12)).toBeNull();
    expect(showingOf(0, 0)).toBeNull();
  });

  // Belt and braces: a total below the row count is a bug upstream, and the page
  // should still not claim a cap that is not there.
  it("says nothing when the total is smaller than the rows", () => {
    expect(showingOf(50, 3)).toBeNull();
  });
});

describe("attentionSentence", () => {
  it("counts failed texts, and agrees with itself about plurals", () => {
    expect(attentionSentence("failed_texts", 3)).toBe("3 texts didn't arrive this week.");
    expect(attentionSentence("failed_texts", 1)).toBe("1 text didn't arrive this week.");
  });

  it("needs no count for a timezone nobody confirmed", () => {
    expect(attentionSentence("unconfirmed_timezone", null)).toBe(
      "Nobody has confirmed the timezone, so every reminder may go out an hour off.",
    );
  });

  it("conjugates the empty-rota sentence both ways", () => {
    expect(attentionSentence("only_draft_rotas", 1)).toBe(
      "1 rota has nobody on it, so it sends nothing.",
    );
    expect(attentionSentence("only_draft_rotas", 2)).toBe(
      "2 rotas have nobody on them, so they send nothing.",
    );
  });

  it("conjugates the opted-out sentence both ways", () => {
    expect(attentionSentence("opted_out_member", 1)).toBe(
      "1 housemate replied STOP but is still on a rota.",
    );
    expect(attentionSentence("opted_out_member", 4)).toBe(
      "4 housemates replied STOP but are still on a rota.",
    );
  });

  it("has words and a pill for every reason the API can send", () => {
    for (const reason of ATTENTION_REASONS) {
      expect(attentionSentence(reason, 2)).not.toBe("");
      expect(ATTENTION_PILL[reason].label).not.toBe("");
    }
  });

  // Semantic colour, and the loudest one reserved for the reason that always
  // costs a real person their reminder.
  it("reserves the destructive tone for failing texts", () => {
    const loud = ATTENTION_REASONS.filter((r) => ATTENTION_PILL[r].tone === "destructive");

    expect(loud).toEqual(["failed_texts"]);
  });
});

describe("the onboarding ladder", () => {
  // The plan's funnel is eight steps; the query derives six. Rung 1 is step 3.
  it("numbers a rung as the plan numbers it", () => {
    expect(planStepNumber(1)).toBe(3);
    expect(planStepNumber(6)).toBe(8);
  });

  it("captions a rung against the whole funnel", () => {
    expect(stepCaption(1)).toBe("Step 3 of 8");
    expect(stepCaption(5)).toBe("Step 7 of 8");
    expect(stepCaption(6)).toBe("Step 8 of 8");
  });

  it("never numbers a house past the end of the funnel", () => {
    expect(planStepNumber(FUNNEL_STEPS.length)).toBe(PLAN_FUNNEL_STEPS);
  });

  it("labels every rung the API can send", () => {
    for (const step of FUNNEL_STEPS) {
      expect(FUNNEL_STEP_LABELS[step]).not.toBe("");
    }
  });
});

describe("staleAfterMs", () => {
  // Fifteen minutes is a sensible cushion on an hourly job and a meaningless one
  // on a daily job, so the grace is the LARGER of a flat floor and a share of the
  // cadence.
  it("gives an hourly job the flat floor, because a quarter of an hour is less", () => {
    expect(HOUR * STALE_GRACE_SHARE).toBe(STALE_GRACE_MS);
    expect(staleAfterMs("reminder_sweep")).toBe(HOUR + STALE_GRACE_MS);
    expect(staleAfterMs("sync_house_calendars")).toBe(HOUR + STALE_GRACE_MS);
  });

  it("gives a daily job a proportional grace, not fifteen minutes", () => {
    expect(staleAfterMs("top_up_shift_windows")).toBe(DAY + 6 * HOUR);
    expect(staleAfterMs("top_up_shift_windows")).toBeGreaterThan(DAY + STALE_GRACE_MS);
  });

  it("never gives any job less than the floor", () => {
    for (const job of JOB_NAMES) {
      expect(staleAfterMs(job)).toBeGreaterThanOrEqual(JOB_CADENCE_MS[job] + STALE_GRACE_MS);
    }
  });
});

describe("isJobStale", () => {
  it("gives an hourly job its cadence plus a grace before complaining", () => {
    expect(isJobStale(ago(30 * MINUTE), "reminder_sweep", NOW)).toBe(false);
    expect(isJobStale(ago(HOUR + STALE_GRACE_MS - MINUTE), "reminder_sweep", NOW)).toBe(false);
    expect(isJobStale(ago(HOUR + STALE_GRACE_MS + MINUTE), "reminder_sweep", NOW)).toBe(true);
  });

  // A daily job is a day behind before anything is wrong — the same rule, a
  // different cadence, read off config/recurring.yml. A 3am run that slipped to
  // 3:20 behind a deploy is not a job that stopped, so an hour late is fine and
  // most of a second day is not.
  it("holds a daily job to a daily cadence, with a proportional grace", () => {
    expect(isJobStale(ago(20 * HOUR), "top_up_shift_windows", NOW)).toBe(false);
    expect(isJobStale(ago(DAY + HOUR), "top_up_shift_windows", NOW)).toBe(false);
    expect(isJobStale(ago(DAY + 7 * HOUR), "top_up_shift_windows", NOW)).toBe(true);
  });

  it("treats the calendar sync as hourly, like the sweep", () => {
    expect(JOB_CADENCE_MS.sync_house_calendars).toBe(HOUR);
    expect(isJobStale(ago(3 * HOUR), "sync_house_calendars", NOW)).toBe(true);
  });

  // For something scheduled hourly this is the loudest thing the tile can say.
  it("calls a job that has never finished stale", () => {
    for (const job of JOB_NAMES) {
      expect(isJobStale(null, job, NOW)).toBe(true);
    }
  });

  it("has a friendly label for every job the API can send", () => {
    for (const job of JOB_NAMES) {
      expect(JOB_LABELS[job]).not.toBe("");
    }
  });
});

describe("plural", () => {
  // Exported for the KPI tiles: "1 covers this week" would undo in one word the
  // care every other figure on the page is rendered with.
  it("picks the one-or-many word off the count", () => {
    expect(plural(1, "cover", "covers")).toBe("cover");
    expect(plural(0, "cover", "covers")).toBe("covers");
    expect(plural(7, "cover", "covers")).toBe("covers");
  });
});

describe("queueFailuresNote", () => {
  it("says none rather than nothing when the queue is clean", () => {
    expect(queueFailuresNote(0)).toBe("No failed jobs in the queue");
  });

  it("counts failures, plural and singular", () => {
    expect(queueFailuresNote(1)).toBe("1 failed job in the queue");
    expect(queueFailuresNote(6)).toBe("6 failed jobs in the queue");
  });

  // Null is "we could not ask", which must never render as an all-clear.
  it("distinguishes an unreadable queue from an empty one", () => {
    expect(queueFailuresNote(null)).toBe("Queue unreachable — failures unknown");
    expect(queueFailuresNote(null)).not.toBe(queueFailuresNote(0));
  });
});
