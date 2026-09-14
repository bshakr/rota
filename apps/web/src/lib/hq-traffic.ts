import type { BarTone } from "@/components/charts/bars";

import {
  DEFAULT_TRAFFIC_RANGE,
  TRAFFIC_RANGES,
  type DeviceClass,
  type TextKind,
  type TrafficFunnelStep,
  type TrafficRange,
  type VisitDimension,
} from "./api/super-admin-traffic";
import { formatCalendarDate } from "./date";
import { FUNNEL_STEP_LABELS, formatRate, plural } from "./hq-overview";

/**
 * The words and the judgement behind HQ's traffic page.
 *
 * Its sibling is ./hq-overview.ts, and the division is the same one: shape in
 * ./api/super-admin-traffic.ts, MEANING here. If you arrived looking for what a
 * key is called, that is the other file; this one decides what it says.
 *
 * Everything here is pure and takes its inputs as arguments. It exists because
 * this is a page where a wrong word is a wrong decision: a rate must never be
 * rounded to a whole percent, a rate over 100% must be shown rather than
 * hidden, "not tracked yet" must not read as zero, and one series — members
 * most recently seen — is a moving column that a plain label would turn into a
 * growth chart. Each of those is a sentence, and each is tested.
 */

// --- The range picker -------------------------------------------------------

/** What each window is called on the segmented control, and under it. */
export const RANGE_LABELS: Record<TrafficRange, string> = {
  "7d": "7 days",
  "30d": "30 days",
  "90d": "90 days",
};

/**
 * The `?range=` in the URL, turned into a window the API will accept.
 *
 * Anything unrecognised falls back to the default rather than being forwarded:
 * Rails answers 400 for an unknown range, and a hand-edited URL or a stale
 * bookmark should show the operator thirty days, not an error page. Rails keeps
 * its own allowlist regardless — this is the page being forgiving, not the API
 * being loose.
 *
 * Next hands back an array when a parameter is repeated (`?range=7d&range=90d`),
 * which is a thing a link cannot produce and a person can. The first value
 * wins, because that is the one they typed first.
 */
export function parseRange(value: string | string[] | undefined): TrafficRange {
  const first = Array.isArray(value) ? value[0] : value;
  const found = TRAFFIC_RANGES.find((range) => range === first);
  return found ?? DEFAULT_TRAFFIC_RANGE;
}

/** The href for a range, so the picker and any deep link agree on one spelling. */
export function rangeHref(range: TrafficRange): string {
  return `/super-admin/traffic?range=${range}`;
}

// --- The funnel -------------------------------------------------------------

/**
 * What each of the eight steps is called, in the product's words.
 *
 * The last six are the overview's OWN labels, imported rather than rewritten:
 * Rails gives both surfaces the same keys because they are the same ladder
 * counted two ways, and two names for one rung is how two pages start
 * disagreeing about what a house did.
 */
export const TRAFFIC_STEP_LABELS: Record<TrafficFunnelStep, string> = {
  landing_views: "Landed on the site",
  signed_in: "Signed in",
  ...FUNNEL_STEP_LABELS,
};

/**
 * The note under a funnel bar: how this step did against the one above it.
 *
 * NEVER CAPPED. A step can convert above 100% — step 4 does it routinely,
 * because `timezone_confirmed_at` is re-stamped every time an admin saves the
 * house settings, so an established house lands in it without ever having been
 * in step 3's count. Clamping that to "100%" would hide the one thing the
 * number is telling you. It is called out in words instead, so a reader knows
 * it is a fact about the window rather than a broken sum.
 *
 * A missing rate is not a zero either, and the two reasons for one are
 * different: the step above is not counted at all, or nobody reached it.
 */
export function funnelRateNote(
  rate: number | null,
  previous: { label: string; tracked: boolean; count: number | null } | null,
): string | null {
  // Step 1 has nothing above it to be a share of.
  if (previous === null) return null;

  // The step above is QUOTED rather than folded into the sentence. Half these
  // labels are verb phrases — "A reminder arrived", "Put people on a rota" —
  // and a sentence built around one reads as broken English ("nobody a reminder
  // arrived"). Quoting names the bar instead of trying to conjugate it.
  const above = `“${previous.label}”`;

  if (rate === null) {
    if (!previous.tracked) return `No rate yet — ${above} isn't counted`;
    return `No rate — nothing reached ${above}`;
  }

  if (rate > 100) return `${formatRate(rate)} of ${above} — more arrived here than above`;

  return `${formatRate(rate)} of ${above}`;
}

// --- Beside the funnel ------------------------------------------------------

/**
 * The median time from signing in to a first text arriving, as a figure.
 *
 * Hours below two days, days above — "68.0h" is a number nobody converts in
 * their head. One decimal either way: the API computed it to a tenth and a
 * figure never renders coarser than it was computed (project rule, BLO-1454).
 */
export function formatMedianHours(hours: number | null): string {
  if (hours === null) return "—";
  if (hours < 48) return `${hours.toFixed(1)}h`;
  return `${(hours / 24).toFixed(1)} days`;
}

/**
 * The line under it, which is always about how much to trust it.
 *
 * The sample is published because this median is survivorship-biased by
 * construction: a house only appears in it once it has actually sent its first
 * text, so the ones still stuck in onboarding are missing rather than dragging
 * it up. Four houses and four hundred deserve different amounts of confidence,
 * and "not enough data" is the honest answer to nil — never 0h.
 */
export function medianHoursNote(hours: number | null, sample: number): string {
  if (hours === null) return "Not enough data in this range";
  return `from ${sample} ${plural(sample, "house", "houses")} that got there`;
}

/**
 * The leak: people who signed in inside the window and still have no house.
 *
 * Read as of NOW, not as of the sign-in — somebody who signed in on Tuesday and
 * made their house on Wednesday converted, and counting them here for the rest
 * of the window would make the leak look permanently worse than it is.
 */
export function leakNote(count: number): string {
  if (count === 0) return "Everybody who signed in made a house";
  return "Got through the door and no further";
}

// --- Where the visits came from ---------------------------------------------

/**
 * The three columns under the funnel, and what each says when it is empty.
 *
 * The empty states are the point of this constant. An empty column has three
 * quite different causes here and they must not read alike:
 *
 *   referrers  nobody was linked here, or everybody arrived directly. A direct
 *              visit carries no referrer at all, so an empty column is normal
 *              for a site whose traffic is word of mouth.
 *   countries  NOT a fact about traffic. The `cf-ipcountry` header only arrives
 *              once the domain is proxied through Cloudflare, and it is DNS-only
 *              there today, so this column is empty however many people visit.
 *              Saying "no countries" would read as "nobody visited", which is
 *              false and is exactly the misreading the funnel's step 1 above it
 *              would then confirm.
 *   devices    nobody visited, near enough: every request carries a user agent
 *              or a client hint, so a visit almost always lands in one of three
 *              buckets.
 */
export const VISIT_COLUMNS: Record<VisitDimension, { heading: string; empty: string }> = {
  referrers: {
    heading: "Which site linked here",
    empty: "Nothing linked here in this window. A visit typed in or tapped from a text carries no referrer.",
  },
  countries: {
    heading: "Country",
    empty: "Country arrives once the site is behind the Cloudflare proxy. The header is not sent while the domain is DNS-only there.",
  },
  devices: {
    heading: "Device",
    empty: "No visit in this window.",
  },
};

/**
 * The three device classes in the product's own words, which are the words the
 * privacy page uses for the same three: a phone, a tablet or a computer.
 */
export const DEVICE_LABELS: Record<DeviceClass, string> = {
  mobile: "Phone",
  tablet: "Tablet",
  desktop: "Computer",
};

/**
 * The line under the three columns: how much of step 1 they could account for.
 *
 * Every column leaves out the visits its property was missing from, so the rows
 * never add up to the funnel's first bar, and a reader who notices that is owed
 * the reason rather than left to assume the page is broken. One decimal, like
 * every other rate here.
 */
export function visitsCoverageNote(counted: number, views: number): string {
  if (views === 0) return "No visit was counted in this window";

  const share = formatRate((counted / views) * 100);
  return `${counted} of ${views} ${plural(views, "visit", "visits")} said which site linked here (${share}). The rest arrived directly.`;
}

// --- The weekly series ------------------------------------------------------

/** "7 Sept" — the Monday a bucket starts on. The API sends a plain date. */
export function weekLabel(weekStarting: string): string {
  return formatCalendarDate(weekStarting);
}

/** "Week of 7 Sept" — the same thing where it has to stand on its own. */
export function weekOfLabel(weekStarting: string): string {
  return `Week of ${weekLabel(weekStarting)}`;
}

/**
 * The three kinds of text, in the product's words rather than the column's, with
 * the pigment the plan names for each.
 *
 * The order is the ORDER THEY STACK, and it is not the plan's listing order.
 * Reminder (lilac, hue 290) and cover notice (sky, hue 234) are the closest two
 * hues in the set — the dataviz palette validator scores that pair at ΔE 14.8
 * for normal vision, under its floor of 15 — so the peach segment is put between
 * them and the two never share an edge. Identity is carried by the legend and by
 * the table of the same numbers underneath, never by colour alone.
 */
export const TEXT_KIND_SERIES: ReadonlyArray<{
  kind: TextKind;
  label: string;
  tone: BarTone;
}> = [
  // "Reminder lilac": grape is lilac's loud cut, the same hue at the lightness a
  // chart mark needs. A sticker pastel here would sit at 1.09:1 on the track.
  { kind: "reminder", label: "Reminders", tone: "grape" },
  { kind: "member_login", label: "Personal links", tone: "peach" },
  { kind: "cover_notice", label: "Cover notices", tone: "sky" },
];

/**
 * The five small multiples under the texting chart, and the caveat each one
 * needs to be read with.
 *
 * `members_last_seen` is the one that would mislead without its note. It counts
 * members whose LAST seen moment falls in that week — one moving column, so a
 * housemate who has opened their link every week for a year appears exactly
 * once, in this week. The series therefore rises towards the present by
 * construction. The label says "most recently seen" for that reason and must
 * keep saying it.
 */
export const WEEKLY_SIGNALS = [
  {
    key: "covers",
    label: "Covers",
    note: "One housemate taking another's turn — the product's one engagement signal.",
    /** Each week is its own event count, so a range total means something. */
    summable: true,
  },
  {
    key: "active_houses",
    label: "Active houses",
    note: "Houses a text actually reached that week. Delivered, not sent.",
    // A distinct count of houses cannot be added across weeks: the same house
    // active every week is one house, not thirteen.
    summable: false,
  },
  {
    key: "active_users",
    label: "Active people",
    note: "Signed in or seen that week, including people who never made a house.",
    summable: false,
  },
  {
    key: "members_last_seen",
    label: "Members most recently seen",
    note: "A member counts in the week they were LAST seen, so this rises towards today by construction.",
    summable: false,
  },
  {
    key: "new_houses",
    label: "New houses",
    note: "Houses created that week — the top of the funnel, drawn week by week.",
    summable: true,
  },
] as const satisfies ReadonlyArray<{
  key: "covers" | "active_houses" | "active_users" | "members_last_seen" | "new_houses";
  label: string;
  note: string;
  summable: boolean;
}>;

export type WeeklySignal = (typeof WEEKLY_SIGNALS)[number];

// --- Failures ---------------------------------------------------------------

/**
 * A failure code's share of every failure in the range, at one decimal.
 *
 * Null is "there is nothing to be a share of" — no failures at all — and gets a
 * dash rather than 0.0%, which would read as "this code accounts for none of
 * them".
 */
export function formatShare(share: number | null): string {
  return share === null ? "—" : formatRate(share);
}

/**
 * The line under the failures table: what the five rows leave out.
 *
 * The shares are all of `total`, which includes failures that carry no code at
 * all, so the rows visibly do not add up to a hundred. Saying so is what makes a
 * top five honest rather than a rounding mystery.
 */
export function failuresNote(total: number, uncoded: number, shown: number): string {
  if (total === 0) return "No text failed in this window";

  const codes = `${total} failed ${plural(total, "text", "texts")}`;
  const rest = total - shown;
  const parts = [codes];

  if (uncoded > 0) parts.push(`${uncoded} with no code`);
  if (rest > uncoded) parts.push(`${rest - uncoded} under other codes`);

  return `${parts.join(" · ")} — shares are of all ${total}`;
}
