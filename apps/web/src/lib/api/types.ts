// The one place the payload types live. Every UI ticket imports from here rather
// than re-declaring a shape and letting it drift from Rails.
//
// These mirror the hand-written serializers in apps/api (which return plain
// hashes precisely so the web app can type off them). Two conventions worth
// stating once:
//
//   - Dates and timestamps arrive as strings, never `Date`. A day is `YYYY-MM-DD`
//     (e.g. `due_on`, `starts_on`); a timestamp is ISO 8601 (e.g. `sent_at`).
//     Format them through `src/lib/date.ts`, never `new Date(...).toLocale…` in a
//     component — the whole product is made of dates and an unpinned zone throws a
//     hydration mismatch.
//   - `… | null` appears only where the column or association is genuinely
//     nullable. A shift always has an `assigned_member`; only `covering_member` is
//     optional.

// ---------------------------------------------------------------------------
// Shared references
// ---------------------------------------------------------------------------

/** A member reduced to what a label needs. Used across shifts, covers and the SMS log. */
export interface MemberRef {
  id: number;
  name: string;
}

// ---------------------------------------------------------------------------
// Admin identity — GET /api/me
// ---------------------------------------------------------------------------

/** The signed-in admin, as Rails resolved them from the WorkOS token. */
export interface AuthUser {
  id: number;
  workos_user_id: string;
  email: string;
  name: string;
}

/** The group the token named. `timezone` here is the raw value; `Group` adds the confirmed flags. */
export interface MeGroup {
  id: number;
  workos_organization_id: string;
  name: string;
  timezone: string;
}

/** GET /api/me — returned at the top level (no wrapper key). Proves the whole auth path in one call. */
export interface Me {
  user: AuthUser;
  group: MeGroup;
  role: string;
}

// ---------------------------------------------------------------------------
// Group — /api/group
// ---------------------------------------------------------------------------

/**
 * The group's settings. `timezone_confirmed` is the load-bearing flag: false means
 * the system guessed UTC on provisioning and no human has confirmed it, which is
 * what the dashboard's timezone warning hangs off.
 */
export interface Group {
  id: number;
  name: string;
  timezone: string;
  timezone_confirmed: boolean;
  timezone_confirmed_at: string | null;
}

/** PATCH /api/group carries a warning (not a block) when the timezone actually moves. */
export interface TimezoneChangeWarning {
  timezone_changed: true;
  detail: string;
}

/** GET and PATCH /api/group. `warning` is present only on a PATCH that moved the timezone. */
export interface GroupResponse {
  group: Group;
  warning?: TimezoneChangeWarning;
}

export interface GroupUpdateParams {
  name?: string;
  /** Sending `timezone` at all is the human confirming it, even if unchanged — Rails stamps the flag. */
  timezone?: string;
}

// ---------------------------------------------------------------------------
// Members — /api/members
// ---------------------------------------------------------------------------

/**
 * A person who takes turns. `access_token` is the member's magic-link token,
 * deliberately exposed on the ADMIN API so an admin can copy or re-text the link —
 * it is not a secret from the admin. `contactable` folds "active and not opted
 * out" into the one boolean the UI acts on.
 */
export interface Member {
  id: number;
  name: string;
  phone_e164: string;
  active: boolean;
  contactable: boolean;
  sms_opted_out_at: string | null;
  access_token: string;
}

export interface MembersResponse {
  members: Member[];
}

export interface MemberResponse {
  member: Member;
}

export interface MemberCreateParams {
  name: string;
  phone_e164: string;
}

export type MemberUpdateParams = Partial<MemberCreateParams>;

/** One future turn the removed member gave up, resolved to whoever holds it now (or nobody). */
export interface ReassignedShift {
  rota_id: number;
  rota_name: string;
  due_on: string;
  now_assigned_member_id: number | null;
  now_assigned_member_name: string | null;
}

/** One cover the removed member had agreed to, now reverted to the shift's assignee. */
export interface DroppedMemberCover {
  shift_id: number;
  rota_id: number;
  rota_name: string;
  due_on: string;
  reverts_to_member_id: number;
  reverts_to_member_name: string;
}

/**
 * DELETE /api/members/:id. Deactivation, never destruction — and it names exactly
 * what moved: the turns redistributed and the covers undone, so "remove Alice" is
 * never a silent reshuffle.
 */
export interface MemberRemovalResponse {
  member: Member;
  reassigned_shifts: ReassignedShift[];
  dropped_covers: DroppedMemberCover[];
}

// ---------------------------------------------------------------------------
// Rotas — /api/rotas (+ positions, preview)
// ---------------------------------------------------------------------------

export type IntervalUnit = "day" | "week" | "month";

/** One roster row. The order across a rota's positions IS the rotation. */
export interface RotaPositionEntry {
  member_id: number;
  name: string;
  position: number;
}

/**
 * A rota: a named job, its schedule, its message, and its ordered roster. `draft`
 * is derived from the roster (a rota with no positions), never stored.
 */
export interface Rota {
  id: number;
  name: string;
  message_template: string;
  starts_on: string;
  interval_count: number;
  interval_unit: IntervalUnit;
  send_hour: number;
  reminder_offsets: number[];
  active: boolean;
  draft: boolean;
  positions: RotaPositionEntry[];
}

export interface RotasResponse {
  rotas: Rota[];
}

/**
 * One shift affected by a regeneration, resolved to names. Shared shape between a
 * schedule-change warning (what confirming WOULD drop) and a regeneration outcome
 * (what it DID drop).
 */
export interface DroppedCover {
  shift_id: number;
  due_on: string;
  assigned_member_id: number;
  assigned_member_name: string;
  covering_member_id: number;
  covering_member_name: string;
}

/** What a schedule change would cost. Arrives on the `confirmation_required` error's `warning`. */
export interface ScheduleChangeWarning {
  future_shifts: number;
  dropped_covers: DroppedCover[];
}

/** What a regeneration actually did. `deleted`/`inserted` are shift counts. */
export interface RegenerationOutcome {
  deleted: number;
  inserted: number;
  dropped_covers: DroppedCover[];
}

/** POST and PATCH /api/rotas/:id, and PATCH after a confirmed schedule change carries `regeneration`. */
export interface RotaResponse {
  rota: Rota;
  regeneration?: RegenerationOutcome;
}

/** PUT /api/rotas/:id/positions always regenerates (a roster change preserves covers). */
export interface RotaPositionsResponse {
  rota: Rota;
  regeneration: RegenerationOutcome;
}

/** POST /api/rotas/:id/preview_message — the live message preview, rendered through the real sender. */
export interface RotaPreviewResponse {
  preview: string;
  member: Member;
  due_on: string;
}

export interface RotaWriteParams {
  name?: string;
  message_template?: string;
  starts_on?: string;
  interval_count?: number;
  interval_unit?: IntervalUnit;
  send_hour?: number;
  active?: boolean;
  reminder_offsets?: number[];
}

export interface RotaPreviewParams {
  /** Preview the in-progress template, not only what was last saved. */
  message_template?: string;
  /** Render as a specific member; defaults to the first on the roster. */
  member_id?: number;
}

// ---------------------------------------------------------------------------
// Shifts — /api/rotas/:rota_id/shifts (read) and /api/shifts/:id (admin override)
// ---------------------------------------------------------------------------

/**
 * One turn, admin view. `responsible_member` resolves `covering_member ||
 * assigned_member` — the single question the reminder job, calendar and this
 * screen all ask — so the client never re-implements the precedence.
 */
export interface Shift {
  id: number;
  rota_id: number;
  due_on: string;
  covered: boolean;
  assigned_member: MemberRef;
  covering_member: MemberRef | null;
  responsible_member: MemberRef;
}

export interface ShiftsResponse {
  shifts: Shift[];
}

export interface ShiftResponse {
  shift: Shift;
}

/** PATCH /api/shifts/:id — the admin override. `null` clears the cover; an id sets it. */
export interface ShiftUpdateParams {
  covering_member_id: number | null;
}

// ---------------------------------------------------------------------------
// SMS delivery log — /api/sms_messages
// ---------------------------------------------------------------------------

export type SmsKind = "reminder" | "cover_notice";

/**
 * The carrier's delivery status (queued, sending, sent, delivered, undelivered,
 * failed, …). Left as a string rather than a union so a new carrier state can't
 * make a valid log row fail to type.
 */
export type SmsStatus = string;

/** Enough of the shift to say which reminder a log row was, without a second lookup. */
export interface SmsMessageShiftRef {
  id: number;
  rota_id: number;
  rota_name: string;
  due_on: string;
}

export interface SmsMessage {
  id: number;
  kind: SmsKind;
  status: SmsStatus;
  error_code: string | null;
  days_before: number | null;
  body: string;
  twilio_sid: string | null;
  sent_at: string | null;
  created_at: string;
  member: MemberRef;
  shift: SmsMessageShiftRef;
}

export interface SmsMessagesResponse {
  sms_messages: SmsMessage[];
}

export interface SmsMessagesQuery {
  status?: SmsStatus;
  kind?: SmsKind;
  member_id?: number;
  rota_id?: number;
  /** Server caps at 500; defaults to 100. */
  limit?: number;
}

// ---------------------------------------------------------------------------
// Member magic-link path — /api/member/*
// ---------------------------------------------------------------------------

/**
 * One upcoming turn as a MEMBER sees it. `can_assign_cover` / `can_cancel_cover`
 * are resolved server-side for this member, so the page shows only the buttons the
 * API would accept — never an action it would then reject.
 */
export interface MemberShift {
  id: number;
  rota_id: number;
  rota_name: string;
  due_on: string;
  covered: boolean;
  assigned_member: MemberRef;
  covering_member: MemberRef | null;
  responsible_member: MemberRef;
  can_assign_cover: boolean;
  can_cancel_cover: boolean;
}

/** GET /api/member/shifts — this member's upcoming shifts and the people they could ask to cover. */
export interface MemberShiftsResponse {
  member: MemberRef;
  shifts: MemberShift[];
  coverable_members: MemberRef[];
}

/** POST and DELETE /api/member/shifts/:id/cover return the updated shift. */
export interface MemberCoverResponse {
  shift: MemberShift;
}
