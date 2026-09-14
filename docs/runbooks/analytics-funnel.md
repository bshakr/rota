# The homepage funnel

Rota Monster had no analytics at all until v0.0.3.1. This is what was added, where each event fires,
and the one number to watch.

There is no third party. No SDK, no script in the page, no analytics cookie, no device or session id.
Events are rows in this app's own Postgres, and the page contacts no external host at all.

**The one number that matters: houses with a text delivered and at least two distinct housemates who
opened their link, within seven days of the house being named.** Nothing should be bought or posted
into any channel until that number is known for organic traffic.

```
bin/rails "analytics:funnel[30]"
```

## The funnel

visit → CTA → sign-in started → sign-in completed → house named → first rota → first housemate →
first text delivered → first housemate opened.

`calendar_connected` is reported separately. It is a side branch off `house_named`, not a step
between two others, and putting it in the sequence would make every conversion after it read as a
collapse.

## The ten events

| Event | Fires from | Where |
| --- | --- | --- |
| `landing_view` | browser | `app/page.tsx`, via `_components/landing-view.tsx` on mount |
| `cta_click` | browser | all three CTAs, via `_components/sign-in-link.tsx`, with `position` |
| `signin_started` | browser | the same click, when the link really is the `/dashboard` hand-off |
| `signin_completed` | Next server | `src/app/callback/route.ts`, `handleAuth`'s `onSuccess` |
| `house_named` | Rails | `Api::GroupController#update`, carrying the first touch |
| `first_rota_saved` | Rails | `Api::RotasController#create` |
| `first_member_added` | Rails | `Api::MembersController#create` |
| `first_text_delivered` | Rails | `Webhooks::TwilioStatusController`, on a carrier receipt |
| `first_member_link_opened` | Rails | `MemberAuthenticatable`, when a member token first resolves |
| `calendar_connected` | Rails | `Api::GroupCalendarController#update` |

`cta_click` and `signin_started` come from the same press and, today, always coincide: all three
calls to action point at `/dashboard`. The second is derived from the href rather than assumed, so a
CTA that one day points at a demo or a pricing page will stop claiming a sign-in it never started.

The three CTAs are wrapped in one small client component that renders the same plain anchor the page
always rendered, with the same class and the same children, and adds only an `onClick`. Nothing in
it can delay or block the navigation: there is no `preventDefault`, no `await`, and the beacon is
handed to the browser to deliver as the page tears down.

The six Rails events fire **once per house** (`first_member_link_opened` once per housemate,
and never while the house is paused: a housemate who opens their link then sees the paused notice
rather than their rota, so the once-ever event is still there to claim when the house resumes).
There is no bookkeeping column per event: "first" is the absence of a rota, of a member, of a connection, a
NULL `timezone_confirmed_at`, or a conditional UPDATE on `members.first_opened_at`.

`first_text_delivered` is the carrier's delivery receipt, not our send. Twilio accepting a message
says nothing about a phone buzzing; the delivery webhook does.

## How an event gets into the table

Two paths, and the split between them is a **security boundary**, not a category.

The first four events happen before a house exists and carry no group. Three are sent by the browser
with `navigator.sendBeacon` (falling back to `fetch` with `keepalive`) to our own
`POST /api/analytics`; the fourth is sent by `/callback`. Both go server-to-server to Rails at
`POST /internal/analytics/events`, authenticated with `ANALYTICS_SHARED_SECRET`.

The six house events are written by Rails in-process and **have no HTTP path at all**. That is
deliberate: anybody can post to `/api/analytics`, so if that route accepted `first_text_delivered`
then a stranger could forge the number the whole funnel exists to measure. `/api/analytics` accepts
only the three browser events; `/internal/analytics/events` accepts only the anonymous four.

Abuse limits on `/api/analytics`: bodies over 2 KB are refused, properties are allowlisted and capped
at 200 characters, and each client IP gets a token bucket of twenty in a burst refilling at one every
three seconds. **That bucket is per server instance** — two instances behind a load balancer allow
twice the rate, and a deploy resets every bucket. It exists so a bored visitor cannot fill the table
from a loop, not to make the counts tamper-proof.

## Identity, and what the events carry

There is none. No cookie, no device id, no session id, nothing written to a visitor's device by the
analytics path. The anonymous events carry only their properties; the house events carry a
`group_id` column and nothing that identifies a person. The funnel is therefore read as aggregate
steps rather than one person's journey. That is a deliberate limit, and it is why the site needs no
consent banner.

Allowlisted properties, and there will never be one that is not on this list: `position`, `path`,
`ref`, `utm_source`, `utm_medium`, `utm_campaign`, `utm_content`, `member_id`. No names, no phone
numbers, no tokens, no calendar URLs, no free text. The list is defined twice, in
`AnalyticsEvent::PROPERTY_KEYS` and in `apps/web/src/lib/analytics.ts`, and a web test reads the Ruby
file and fails if the two ever drift apart.

## First-touch attribution, and why there is still one cookie

Every CTA hands off to WorkOS, which returns the visitor to `/callback` with a fresh URL, so the
`?utm_source=…` or `?ref=member` they arrived with is gone by the time a house exists.

`apps/web/src/proxy.ts` therefore writes those parameters to an httpOnly, SameSite=Lax, thirty-day
cookie (`rm_first_touch`) on the first request to `/` that carries any of them, and never overwrites
one that is already set. `/setup` reads it, sends it to Rails on the request that names the house,
and clears it. `groups.first_touch` stores it, and refuses to overwrite a value it already has.

**This is a functional cookie, not a tracking cookie.** It is not read by any analytics code, it
carries no identifier, and it is never used to recognise a returning visitor. Its entire job is to
carry five strings across one redirect so that `groups.first_touch` can be written once, at `/setup`.
Nothing reads it afterwards, and `/setup` deletes it.

Only five keys survive: `utm_source`, `utm_medium`, `utm_campaign`, `utm_content`, `ref`. Each is
trimmed and capped at 200 characters. A visitor who arrives with none gets no cookie, so "first
touch" means "the first visit that carried a campaign" — a direct visit leaves the slot open.

`ref=member` is the one that is already real: it is on the "start one for your house" link in a
housemate's own feed.

## Reading the numbers

```
bin/rails "analytics:funnel[30]"     # every step, each as a percentage of the one before,
                                     # plus the number that matters
bin/rails "analytics:sources[30]"    # houses named, grouped by ref and utm_source
```

Quote the task name in zsh: brackets are globs. The argument is a number of days and defaults to 7.
Rates print to one decimal, never rounded to a whole percent.

A super admin page for all of this is a follow-up ticket. These tasks exist so the numbers are
readable the day the events start arriving rather than the day a screen is built for them.

## Retention

```
bin/rails "analytics:prune[90]"
```

Deletes anonymous events older than ninety days. A house's own events are kept for as long as the
house is, and go with it: the foreign key cascades, so a deleted house's funnel rows can never
outlive it and be miscounted as anonymous traffic.

There is no scheduler entry for this yet. Run it by hand, or add it to the Solid Queue recurring
schedule when anonymous volume makes it worth it.

## Switching it on

One variable, in the repo-root `.env`:

```
ANALYTICS_SHARED_SECRET=      # openssl rand -hex 32
```

With it unset the Next handler forwards nothing and the Rails endpoint answers 404 to everybody, so
there is no open write path into the events table. The six house events are written in-process and
are unaffected. Nothing here is required to boot, in any environment.
