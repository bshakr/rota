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

One property is the exception worth reading carefully, and it is the exception that proves the rule:
`first_visit_today`. See **Counting browsers, not just visits** below. It says whether the browser
behind a landing view had already been here that day, and there is nothing on the row, or in the
table, to say which other row it was.

Allowlisted properties, and there will never be one that is not on this list: `position`, `path`,
`ref`, `utm_source`, `utm_medium`, `utm_campaign`, `utm_content`, `member_id`, `referrer_host`,
`country`, `city`, `device`, `browser`, `os`. No names, no phone numbers, no tokens, no calendar
URLs, no free text. The list is defined twice, in `AnalyticsEvent::SENT_PROPERTY_KEYS` and in
`apps/web/src/lib/analytics.ts`, and a web test reads the Ruby file and fails if the two ever drift
apart. `AnalyticsEvent::PROPERTY_KEYS` is that list plus `first_visit_today`, which no sender may
set.

The last six are the coarse facts about a visit that the traffic page's "Where visits come from"
panel is drawn from, and each is deliberately too broad to narrow anybody down:

| Property | Where it comes from | What it can be |
| --- | --- | --- |
| `referrer_host` | the browser, from `document.referrer` | the HOST only, lowercased. The path and the query are dropped before the event is sent, because that is where a search term or an email address would be. Omitted for a direct visit and for one of our own pages |
| `country` | the server, from Cloudflare's `cf-ipcountry` header | two uppercase letters. Cloudflare's `XX` (unknown) and `T1` (Tor) are dropped. Arrives on every visit since the domain was proxied on 14 September 2026. No GeoIP library is used and the IP is never stored, logged or forwarded |
| `city` | the server, from Cloudflare's `cf-ipcity` header | the city NAME, as sent, capped at 200 characters and checked against a letters/spaces/hyphens/apostrophes/dots pattern. Only kept when a `country` was read too, because a city with no country is not the output of a working lookup. **Absent in production today**, because the header only arrives once the zone's Managed Transform "Add visitor location headers" is switched on. The finer location headers are NEVER read: not `cf-iplatitude`, `cf-iplongitude`, `cf-postal-code`, `cf-region`, `cf-metro-code` or `cf-timezone` |
| `device` | the server, from the `sec-ch-ua-mobile` client hint, falling back to the user agent | one of `mobile`, `tablet`, `desktop`. The agent string is matched and discarded; it is never stored |
| `browser` | the server, from the `sec-ch-ua` brand list, falling back to the user agent | one of `chrome`, `safari`, `firefox`, `edge`, `samsung`, `other`. A FAMILY and never a version. Samsung Internet and Edge are matched before Chrome because both announce "Chromium" too; Brave, Opera and Vivaldi count as Chrome, which is the engine that renders our pages |
| `os` | the server, from `sec-ch-ua-platform`, falling back to the user agent | one of `ios`, `android`, `macos`, `windows`, `linux`, `other`. A FAMILY and never a version. An iPad in desktop mode reports itself a Macintosh in both the hint and the agent, so some iPads count as `macos` |

`country`, `city`, `device`, `browser` and `os` are set server-side in
`apps/web/src/app/api/analytics/route.ts` and are NOT on the browser's own allowlist, so a value
posted by hand is dropped on the way through rather than deleted afterwards. Rails checks all six
again on arrival and drops one whose shape is wrong, keeping the event.

## Counting browsers, not just visits

"1,420 views" and "1,420 views from 887 browsers" are different findings, and only the second says
whether a link worked. This is counted the Plausible and Fathom way: no cookie, nothing written to
the visitor's device, and therefore still no consent banner.

**The daily visitor code.** `apps/web/src/app/api/analytics/route.ts` (`visitorDigest`) computes, for
a `landing_view` only:

```
sha256( hmac_sha256(ANALYTICS_SHARED_SECRET, "visitor-salt:" + YYYY-MM-DD in UTC) + "|" + ip + "|" + user agent )
```

The inner HMAC is the day's SALT. It is derived per request, never stored, and a new one exists every
UTC day, so a code from yesterday cannot be recomputed today by anybody, us included. The address and
the agent are both already read by that handler (the address for the rate limiter's bucket, the agent
for the device, browser and system families) and neither is stored, logged or forwarded.

No `ANALYTICS_SHARED_SECRET` and no code: the events still flow, and the deploy counts visits without
counting browsers. No address on the request and no code either, because a shared "unknown" code
would count every such visit as one browser.

**How it travels.** In the `X-Analytics-Visitor` header on the existing server-to-server forward
(`apps/web/src/lib/analytics-server.ts`), **never in the properties body**. A property is a thing
that gets written into a row and kept for 180 days; a header is a thing the controller reads, answers
a question with and drops.

**What Rails does with it.** `Internal::AnalyticsEventsController` checks the shape (64 lowercase hex
characters, anything else ignored) and calls `DailyVisitor.claim`, which is an `insert_all` with
`unique_by: [day, digest]` against the `daily_visitors` table: ON CONFLICT DO NOTHING, so the insert
itself IS the question. A row taken means `first_visit_today: true` on the landing view, a conflict
means `false`, and no code at all means the property is simply absent.

**`first_visit_today` is off `AnalyticsEvent::SENT_PROPERTY_KEYS`**, which is the list the endpoint
permits a body against, and on `PROPERTY_KEYS`, which is what a row may contain. Anybody who could
post it could add a thousand visitors to the traffic page without sending a thousand visits.

**Absent, true and false are three different facts.** Absent is a visit nobody counted as a browser
(every row written before 15 September 2026, and every row on a deploy with no shared secret); false
is a browser that had already been here today. The traffic page reads 0 visitors beside a healthy
view count as "not counted", never as "nobody came".

**What it is, precisely: browser-days.** One browser back on three days counts three. One that
reloaded thirty times this morning counts one. There is no cross-day figure and there cannot be one,
which is why this product publishes no "returning visitors" anywhere.

**Retention.** A `daily_visitors` row is kept for the day it belongs to and the day after, then
deleted: `DailyVisitor.prune`, run by `analytics:prune` and by the `prune_daily_visitors` entry in
`config/recurring.yml` (daily, 2:40am UTC). The privacy page promises a day in words, so that
schedule entry is part of the feature rather than housekeeping — and it is an entry of its own
rather than a second statement beside the event sweep, because two statements in one command share
a fate.

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
bin/rails "analytics:sources[30]"    # houses named, grouped by ref and utm_source, then the
                                     # landing views by referrer, country, city, device,
                                     # browser and operating system
```

Quote the task name in zsh: brackets are globs. The argument is a number of days and defaults to 7.
Rates print to one decimal, never rounded to a whole percent.

`analytics:funnel` prints the browsers beside the landing views, with the views each to one decimal.
A window with no counted browsers prints "no visitor counted in this window" rather than a zero: see
**Counting browsers, not just visits** above for why 0 and "not counted" are different answers.

`analytics:sources` prints seven tables. The first is first touch, which is about the visits that
became HOUSES. The six under it are about the visits themselves, each with a `(none)` row for the
views the property is missing from: a direct arrival has no referrer, and no visit has a city until
the zone's "Add visitor location headers" transform is switched on. The super admin traffic page
draws the same six in its "Where visits come from" panel, as two rows of three.

## Retention

```
bin/rails "analytics:prune[180]"
```

Deletes anonymous events older than a hundred and eighty days, which is the default the task takes
when you pass it no number. Twice the longest window the super admin traffic page offers, so the
oldest bucket of a 90-day range is never being pruned while the page is still drawing it. A house's
own events are kept for as long as the
house is, and go with it: the foreign key cascades, so a deleted house's funnel rows can never
outlive it and be miscounted as anonymous traffic.

The same task also empties `daily_visitors` of everything before yesterday. That half takes no
argument: a visitor code means nothing after the day it was made, because the salt behind it has
changed, so how long to keep one is not a choice to make at a command line. `DailyVisitor::RETENTION`
is the rule.

`config/recurring.yml` runs the same two deletions as separate entries: `prune_daily_visitors`
(`DailyVisitor.prune`) daily at 2:40am UTC, and `prune_anonymous_events`
(`AnalyticsEvent.prune_anonymous`) at 2:45am. Scheduled rather than left to be run by hand because
the privacy page tells a visitor their daily code is deleted, and a promise with a rake task behind
it is not a promise. Separate rather than one command because the codes are the half that carries
the promise and the events are the half that can get slow, and two statements in one command share
a fate.

## Switching it on

One variable, in the repo-root `.env`:

```
ANALYTICS_SHARED_SECRET=      # openssl rand -hex 32
```

With it unset the Next handler forwards nothing and the Rails endpoint answers 404 to everybody, so
there is no open write path into the events table. The six house events are written in-process and
are unaffected. Nothing here is required to boot, in any environment.

The same variable is the seed the daily visitor code's salt is derived from, so unsetting it also
stops browsers being counted. Deliberately not a second variable: a deploy that can forward events
counts browsers, and one that cannot does neither.
