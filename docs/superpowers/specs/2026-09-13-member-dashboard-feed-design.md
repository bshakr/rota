# Member dashboard feed (BLO-1666) — design

- Ticket: https://linear.app/bloombase/issue/BLO-1666/member-dashboard-whole-rota-feed-people-strip-and-ranked-hand-off
- Wireframes (Option A chosen on 2026-09-13): https://claude.ai/code/artifact/894ed824-28c2-4288-bdba-aa4a9d19fdd5
- Follow-up: house calendar sync is BLO-1667, a separate spec. This spec is written so that work plugs in without reshaping the page.

## 1. Problem

Members open a magic link (`/s/<token>`) and see only their own upcoming shifts. To hand a shift off sensibly they need to know who else is on that week and what the rest of the house is doing. Today they cannot see the whole rota or the other housemates at all, and the cover dialog is a flat list of names with no signal about who is a reasonable ask.

## 2. Goals and non-goals

Goals
- Show the whole upcoming rota for the house in one chronological feed, mobile first, with the member's own rows highlighted.
- Show every housemate and let the member narrow the feed to one person or one rota.
- Rank cover candidates when handing off, using the rest of the rota.
- Keep the existing token safety model: the token never reaches the client.

Non-goals (this ticket)
- Calendar events and away dates (BLO-1667). The feed and the ranking leave room for them.
- Two-way swaps. Hand-off stays one-way, as the API implements it today.
- Any admin-side change, feature flag, or change to reminders and SMS.

## 3. Experience

Reference artboards: "Option A · Feed · mobile" and "Option A · Feed · desktop", plus "Hand off sheet (shared)". The artboards are illustrative; where they differ from this document, this document wins. One known difference: the artboards label 14–20 Sep "This week" although the sample "today" is Sunday 13 Sep. The rule in 3.4 applies.

### 3.1 Page structure (phone, single column)
1. Header: house name, "Hi {first name}", today's date in the group's calendar.
2. Next-shift card: the member's next shift they are responsible for, with rota name, date, relative day, and a "Hand off" button when `can_assign_cover` is true. Under it, up to two further own shifts as a one-line "Then …" note. If they are covering someone, the card says so. If they have nothing upcoming, the card reads "Nothing on your plate" and the feed still shows.
3. People strip: horizontally scrollable avatars with initials on pastel tints, first name below, "You" for the viewer. Tapping an avatar filters the feed to rows where that person is responsible or assigned; tapping again clears. Members who cannot be texted (opted out) render muted with a "can't be texted" hint in the hand-off sheet, but still appear in the strip: they are still part of the house.
4. Filter chips: "Everyone" (default), "Just me", then one chip per active rota. Chips wrap onto a second line rather than clipping. A person filter and a rota filter can combine; "Everyone" clears the rota filter, tapping the selected avatar clears the person filter.
5. Feed: sections per week (3.4), each containing day rows. A day row shows a date coin (weekday over day number), then one line per shift due that day: rota name, responsible member's avatar and name, and a COVER tag with "{covering} covering {assigned}" when covered. Rows where the viewer is assigned or covering are highlighted and carry a YOU tag; when hand-off is allowed the row has a "Hand off" text button; when the viewer has handed the shift off it shows "{name} is covering" with a "Take it back" text button that runs the existing cancel-cover flow. Today's row carries a "Today" tag.
6. Four weeks are rendered initially; "Show more weeks" reveals the rest of the payload (up to the 90-day generation window) without a request.

### 3.2 Desktop (≥ 1024px)
Two columns: the feed on the left (filter chips above it), and a 360px sidebar with a "You" card (next three own shifts, hand-off on the first) and a "People" card listing every housemate with their next responsible shift. The people strip is not shown on desktop; the People card's rows are the person filter instead. Below 1024px the layout is the phone layout. The member layout's container is currently capped at `max-w-lg`; it gains a wider variant on `lg` so the sidebar fits, and the phone layout is unchanged.

### 3.3 Hand-off sheet
Opens from any "Hand off" control. A bottom sheet on phone and a centred dialog on desktop (shadcn `Sheet` and `Dialog`), same content:
- Title "Hand off {rota}", subtitle "{weekday} {day} {month} · {relative day}".
- Candidates grouped, in this order: "Free that week", "Has a shift that week" (each with the shift they have, e.g. "Bins · Sun 27 Sep"), "Can't be texted". Within a group, fewest upcoming responsible shifts first, then name. Groups with no one are omitted.
- Radio selection, nothing preselected. Primary button "Hand off to {name}", disabled until a choice is made. Secondary "Cancel".
- Footnote states what actually happens: reminders for this shift go to the chosen person. Implementers confirm the wording against what the API does on assign-cover and change it only if the behaviour differs.
- Members who cannot be texted are listed but not selectable. The viewer and the shift's assigned member are never listed.
- On success the sheet closes and the row updates in place from the API response (existing optimistic pattern in `shift-list.tsx`). On failure the existing error handling applies.

### 3.4 Weeks and dates
- Weeks run Monday to Sunday in the group's calendar. "This week" is the week containing `today`; "Next week" follows; later weeks are labelled by their date range ("28 Sep – 4 Oct", "5–11 Oct"). If today is a Sunday, "This week" contains only today.
- Only shifts with `due_on >= today` appear. Past shifts are out of scope for this page.
- All date arithmetic uses civil dates (`YYYY-MM-DD` strings) with the `today` the API returns, never the browser clock or the app-wide `TIME_ZONE` constant.

### 3.5 Empty and edge states
- No upcoming shifts in the house (all rotas draft or nothing generated): the feed shows "Nothing on the rota yet".
- A filter matches nothing: "No shifts for this filter" with a "Show everyone" button.
- One-member house: the people strip shows the viewer alone; the hand-off sheet says "No one else can cover yet" with only "Cancel".
- Long names truncate with an ellipsis; initials use the first letters of the first two words.

## 4. Data

### 4.1 New endpoint: `GET /api/member/schedule`
Authenticated exactly like the existing member endpoints (Bearer member token, `Api::MemberBaseController`, `authenticate_member!`). Response:

```
{
  "today": "2026-09-13",
  "timezone": "Europe/London",
  "member": { "id": 3, "name": "Bass" },
  "members": [ { "id": 3, "name": "Bass", "contactable": true }, ... ],
  "rotas": [ { "id": 1, "name": "Bins" }, ... ],
  "shifts": [ MemberShift, ... ]
}
```
- `today` is `group.today` (group calendar, never UTC); `timezone` is the group's.
- `members`: every active member of the group including the viewer, ordered by name; `contactable` mirrors `Member#contactable?`.
- `rotas`: the group's active, non-draft rotas ordered by name. `Rota#draft?` is derived from the roster, so the controller loads active rotas with their positions and rejects drafts in Ruby, then scopes shifts to the surviving rotas.
- `shifts`: every shift of those rotas with `due_on >= today`, ordered by `due_on` then rota name, serialised with the member controllers' existing `serialize_shift` (in `Api::MemberBaseController`; the new controller inherits it) so each carries `rota_id`, `rota_name`, `due_on`, `covered`, `assigned_member`, `covering_member`, `responsible_member`, `can_assign_cover`, `can_cancel_cover`. The `can_*` flags are computed relative to the calling member, as today. No window parameter: the generator already bounds shifts to 90 days.
- `GET /api/member/shifts` stays as it is. The page stops calling it; removing it is a later cleanup once nothing depends on it.
- `POST` and `DELETE /api/member/shifts/:id/cover` are unchanged and remain the only writes.

### 4.2 Web client
- `getMemberSchedule(token)` in `apps/web/src/lib/api/member.ts` (server-only, same fetch wrapper and `cache: "no-store"`).
- New types in `apps/web/src/lib/api/types.ts`: `ScheduleMember` (`MemberRef` plus `contactable`), `RotaRef`, `MemberScheduleResponse`.
- The server component `page.tsx` fetches the schedule, keeps the token server-side, binds the existing server actions, and passes plain data plus opaque actions to the client tree, exactly as the current page does. The token-safety test is extended to the new tree.

## 5. Web architecture

Files under `apps/web/src/app/(member)/s/[token]/` and `apps/web/src/components/member/`:
- `schedule-view.ts` (pure): builds the view model. Week bucketing and labels (3.4), day rows, filters (`everyone | me | rota:<id>` combined with an optional `person:<id>`), the viewer's next shifts, and per-person "next shift". Unit-tested with Vitest in the node environment like the existing `shift-view.ts`.
- `cover-ranking.ts` (pure): `rankCoverCandidates(shift, schedule)` returning `{ free, busy, unavailable }` per 3.3. Each candidate carries the member, the shifts they are responsible for in the shift's week, and their upcoming responsible count. Unit-tested. BLO-1667 will add an `away` group here and nowhere else.
- `member-feed.tsx` (client): owns filter state and the hand-off sheet state, renders the layout; composes `next-shift-card.tsx`, `people-strip.tsx`, `filter-chips.tsx`, `week-section.tsx`, `shift-row.tsx`, `hand-off-sheet.tsx`, and the existing `ConfirmDialog` for taking a shift back. The shift update logic moves out of `shift-list.tsx` into a small hook (`use-shift-updates.ts`) so both the row and the sheet share it. `shift-list.tsx` and `AskCoverDialog` are replaced; `shift-card.tsx` is removed if nothing else imports it.
- Styling uses the Soft Clay tokens and components already on `main` (badge, button, card, sheet, dialog). The "you" highlight uses the existing "now" (Lemon) tint and the primary (Grape) outline; avatar tints come from the existing tint family. No new colours.
- Hit targets on phone are at least 44px. Chips and avatar buttons expose `aria-pressed`.

## 6. Security and privacy
- Every member with a valid link sees every housemate's name and shift dates for their own group only. Request specs prove a member of one group never receives another group's members or shifts, and that inactive members' tokens are rejected as today.
- The token continues to live only in server code; no client component receives it.

## 7. Testing
- API (RSpec, factories): request specs for `/api/member/schedule` covering auth, group scoping, `today` and `timezone`, member ordering and `contactable`, rota filtering (draft and inactive excluded), shift window and ordering, and `can_*` flags relative to the caller.
- Web (Vitest): `schedule-view` (week labels around a Sunday today, year boundary, filters, next-shift selection, per-person next shift), `cover-ranking` (grouping, ordering, exclusions), token safety.
- Manual QA on the seeded demo house at phone (390px) and desktop (1440px) widths: feed, filters, hand-off, take back, empty filter state.
- PR carries before/after screenshots for `/s/<token>` at both widths, published as a gallery artifact and linked from the PR body.

## 8. Rollout
- One PR on branch `BLO-1666-member-dashboard-feed`, API and web together; the API change is additive so the order of deploy does not matter.
- No feature flag exists in the app; the new page replaces the old one on merge, which deploys to production (rota.monster). The PR is held for review and screenshots before merge.

## 9. Hooks for BLO-1667 (calendar sync)
Kept here so the follow-up does not reshape this page: the schedule payload gains an `events` array (title, start and end civil dates, optional time, `kind: "event" | "away"`, `member_ids`); `schedule-view` interleaves events into day rows and marks people away; `cover-ranking` adds an `away` group after "Has a shift that week"; the people strip shows an away dot. Sync approach agreed on 2026-09-13: the admin pastes the calendar's private iCal address into group settings, an hourly Solid Queue job fetches and parses it (`icalendar` plus recurrence expansion), and "away" is inferred from event titles that begin with a housemate's name and a travel phrase.
