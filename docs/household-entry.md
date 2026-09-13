# Household access

## Current scope

- Household setup: merged in https://github.com/bshakr/rota/pull/23. Automated checks pass; production redirects to the correct WorkOS callback. A real user still needs to complete sign-in, create a household and confirm its name/timezone on the dashboard.
- Household entry: `/h/<slug>`, members login only. Deployed; the existing-household entry form was verified in production on 2026-09-12.
- Parked: super-admin and full member accounts.

## Admin-managed members, not public signup

The household admin first adds each member and phone number. Share the household entry link from dashboard settings afterwards. Visiting the entry page shows the house's name and a phone form, never its roster or schedules.

The dashboard also provides prominent **Open household page** and **Copy link** controls. Always share the full saved link, including its suffix, rather than typing the household name as a URL. If copying is unavailable, open the page and copy the browser address. A missing household URL points admins back to the dashboard and tells members to ask their admin for the full link.

Submitting the form looks for exactly one existing, active, SMS-contactable member with that normalized phone number **inside the selected household**. It does not create a member, user, organization or membership. Unknown, inactive, opted-out or ambiguous numbers receive no SMS. All these cases return the same neutral confirmation as a successful request.

Members receive their existing personal `/s/<token>` link. No Google login, password or new member account. The link is a reusable credential, not a one-time code; members should keep it private. Admins can rotate it through the existing member-link controls. Reminder links continue working.

## Delivery and limits

Entry requests use `SmsMessage(kind: member_login)` and the existing `SendSmsJob`, including contactability checks at send time, atomic send claims, retries and Twilio delivery receipts. Personal-link messages appear in the household's admin SMS log without a shift. Reminder/cover messages still require a shift at both model and database level.

Persisted attempts, including failed sends, are bounded by a PostgreSQL transaction/advisory lock across API instances:

- One request per phone per minute; three per rolling hour; five per rolling day, across households.
- Sixty requests per household per rolling hour.
- One hundred requests globally per rolling hour; two hundred per rolling day.

These limits do not depend on forwarded IP headers or cache retention. Throttled requests receive the neutral confirmation and do not queue another SMS. Queue-enqueue failures return a retryable service error; a persisted pending row still consumes its attempt budget and remains visible in the admin log.

## Links and deployment

Slugs are immutable, globally unique, normalized labels with a suffix. Existing households are backfilled using their ID; newly created households use a short random suffix. The name available at initial provisioning determines the label; renaming does not change an existing URL. Customizable vanity slugs are outside this slice.

Deploy the API migration/code before enabling the new web page. No new secrets or Railway variables are required. The migration supports inserts from the previous API version while deployment is in flight, and retains all existing reminder constraints. Roll forward rather than dropping login history to reverse the migration.

Run the migration/concurrency smoke test in a throwaway local database:

```sh
cd apps/api
RAILS_ENV=test bin/rails runner script/household_entry_migration_smoke.rb
```

It tests existing-house backfill, duplicate names, previous-version inserts, and concurrent login claims, then regenerates `db/schema.rb` and removes only its own temporary database. Normal CI runs `bin/ci` (API) and `npm run ci` (web). Browser testing must use the null SMS adapter and local test data; do not send live messages as a side effect of QA.

## Verification (2026-09-12)

- API CI: 516 specs pass, Ruby style clean, gem audit and Brakeman clean.
- Web CI: 143 tests pass, lint/typecheck/theme checks/build/client-token safety pass.
- Migration smoke: duplicate/Unicode-name backfill, rolling-deploy default and five simultaneous login requests pass (one claimed SMS).
- Production-build browser test: known phone queues one SMS; unknown valid phone queues none and creates no member; same neutral response. Mobile and desktop have no horizontal overflow. No real SMS sent; browser fixtures removed afterwards.
- Public page disables prefetch on admin/home links so viewing it does not initiate background WorkOS calls. Final browser console is clear.
- Separate pre-existing issue: `npm audit --omit=dev` reports 14 dependency findings, including critical advisories on the pinned Next.js version. No dependency changes in this work; assess and patch separately before rollout. Audit findings are not proof these code paths are exposed by this app.

Live household setup still requires the owner's Google/WorkOS sign-in test. The entry form is live; the navigation improvements described above require deployment of their follow-up change.
