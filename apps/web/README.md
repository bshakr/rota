# apps/web

Next.js 16 (App Router) · React 19 · TypeScript · Tailwind 4 · shadcn/ui (Radix base)

The admin UI and the member magic-link pages. Rails (`apps/api`) owns everything
that matters; this app renders and authenticates.

## Run it

```bash
npm install
npm run dev        # http://localhost:3001
```

**Port 3001 is not negotiable.** The API's CORS allowlist is built from `APP_URL`,
which is `http://localhost:3001`. Rails is on 3000.

Config comes from the **single `.env` at the repo root**, not from `apps/web/.env`.
`next.config.ts` points dotenv at `../../.env`, the same file
`apps/api/config/application.rb` reads. Copy `.env.example` to `.env` at the repo
root once and both apps are configured.

## First household setup

After signing in, users without a selected WorkOS organisation go to `/setup`
before the admin layout or API client requests household data. New users enter a
household name and timezone; users with active memberships choose an existing
household instead. Setup switches to an organisation-bound session before calling
Rails to provision and configure the household, then opens `/dashboard`.

Setup saves progress in WorkOS and reuses a user-specific organisation external ID
so retries recover the initial household instead of creating duplicates. Inactive
or previously removed memberships are not automatically restored.

If Rails rejects a household session, `/auth/reauth` shows an explicit sign-in
prompt. `/auth/sign-in` starts AuthKit login in a route handler, where writing
login cookies is allowed, rather than during a Server Component render.

## The gate

```bash
npm run ci         # lint + typecheck + check:tokens + build
```

Exactly what CI runs. `bin/ci` is the Rails half.

`npm run check:tokens` is the one that will surprise you: it reads `globals.css`
and fails if a semantic token is defined for light but never redefined for dark
(it would silently inherit the light value), or if any foreground/background
pairing drops below WCAG AA in either theme.

## Error reporting

Unhandled exceptions go to Sentry (project `rota-web`; Rails reports to `rota-api`).
The plan and the privacy contract are in [`docs/sentry-error-logging.md`](../../docs/sentry-error-logging.md).

| File | What it is |
| --- | --- |
| `sentry.server.config.ts` / `sentry.edge.config.ts` | One `Sentry.init` per server runtime. Imported by `register()`, per `NEXT_RUNTIME`. |
| `src/instrumentation.ts` | `register()`, plus `onRequestError` — the single hook that reports Server Components, Route Handlers, Server Actions **and `proxy.ts`**. Next 16 does not auto-instrument the proxy. |
| `src/instrumentation-client.ts` | The browser SDK. Turbopack requires this file; the old `sentry.client.config.ts` is not read. |
| `src/lib/observability/scrub.ts` | `beforeSend` / `beforeBreadcrumb` on **both** runtimes. Rewrites E.164 numbers, `/s/<token>` links, `Bearer …`, email addresses and bare 43-char tokens, and deletes the request cookies and the `cookie` / `authorization` headers. Its Ruby twin is `apps/api/app/lib/sentry_scrubber.rb`; `scrub.test.ts` proves none of the five fixtures survives a serialised event. It carries no `server-only` guard on purpose: the browser needs it. |
| `src/app/global-error.tsx` | The root-layout boundary. Renders its own `<html>`/`<body>` and imports `globals.css`, because it *replaces* the root layout. |
| `next.config.ts` | `withSentryConfig`: source-map upload (skipped without a token) and `tunnelRoute: "/monitoring"`. |

Browser events are tunnelled through `/monitoring` on our own origin, because ad
blockers block `sentry.io` and an admin running uBlock is exactly our user. That
path is therefore excluded from the proxy matcher in `src/proxy.ts` and
`src/lib/auth/proxy-matcher.ts`, or every event POST would be answered with a
WorkOS sign-in redirect.

**`NEXT_PUBLIC_SENTRY_DSN` and `NEXT_PUBLIC_SENTRY_ENVIRONMENT` are the only two
`NEXT_PUBLIC_` variables in this repo**, and both exceptions are deliberate.
`next.config.ts` exports nothing through Next's `env` key precisely so no secret is
inlined into the browser bundle — but neither of these is a secret. A DSN is a
public, write-only address, rate-limited by Sentry, and in our case reached through
our own tunnel; the browser cannot report an error it cannot address. The
environment is a name, and the browser needs its own copy because it cannot read the
server's `SENTRY_ENVIRONMENT`: without it every deploy reports as `production`
(NODE_ENV is `production` in any Railway build) and a preview deploy's browser
events land in the production project's alert rules. Both are inlined at build time,
so on Railway both must be **build** variables, not runtime ones. Everything else
Sentry needs (`SENTRY_ENVIRONMENT`, `SENTRY_RELEASE`, and the build-only
`SENTRY_AUTH_TOKEN` / `SENTRY_ORG` / `SENTRY_PROJECT`) stays server-side.

**The build passes with no Sentry variables at all**, which is what CI runs: with
no auth token the source-map upload is disabled rather than attempted, and with no
DSN every `Sentry.*` call is a no-op. Only `production` and `preview` ever send, so
`npm run dev` stays silent even with a DSN in the root `.env`.

`src/app/debug/sentry-smoke/` is temporary and gated on `SENTRY_SMOKE=1`; without it
the route is a 404. It throws during a server render so one signed-in visit produces
both a server event and a browser event; set the variable, visit it, unset it, and
delete the directory once both have been seen in production.

## The design system

**Open `/styleguide`.** Every token and every component is rendered there, in both
themes, with a note on what each is *for*. That page is the reference; this file
only lists the rules that are easy to break by accident.

### Three rules

1. **Never a raw colour in a component.** No hex, no `oklch()`, no `bg-red-500`.
   Two things enforce it: `globals.css` tears Tailwind's default palette out of
   the compiler with `@theme { --color-*: initial }`, so `bg-red-500` / `text-white`
   generate **no CSS at all**; and ESLint fails the build on hex, `oklch()`, inline
   colour styles, and any default-palette utility that slips through. Reach for a
   semantic token.
2. **One accent.** Clay, via `--primary`. A second saturated colour on a screen
   means something has gone wrong. Status colours are the only exception, and only
   for status.
3. **Mobile first.** The member page is a phone page that happens to work on
   desktop. Design at 375px.

### Tokens that are easy to get wrong

| Token | It is |
| --- | --- |
| `--primary` | The clay accent. CTAs, links, focus. **This is the brand colour.** |
| `--accent` | *Not* the brand colour. shadcn's subtle hover tint. Name inherited from shadcn. |
| `--border` | Decorative hairline: card edges, separators. Low contrast on purpose. |
| `--input` | A real control boundary: form fields. Darker, because WCAG wants 3:1 here. |
| `--success` / `--warning` / `--info` | Rota Monster additions, for the SMS delivery log. `<Badge variant="success">`. |

### Shared primitives: reach for these before inventing

Every one of these exists because otherwise five screens would each build it
differently. All are shown live in `/styleguide`.

| Use it for | Component |
| --- | --- |
| Page gutter (the one padding + max-width) | `<Container width="admin\|prose\|member">` |
| Admin screen heading | `<PageHeader>` |
| "Nothing here yet" | `<EmptyState>` |
| A destructive/consequential confirm | `<ConfirmDialog>` (solid confirm, quiet cancel, the correct hierarchy) |
| A submit in flight | `<Button loading>` |
| Names → initials, "+2 more" | `initials()`, `nameList()` in `src/lib/format.ts` |
| Member shift + cover states | `src/components/member/` (`ShiftCard`, `InvalidLink`) |

`error.tsx`, `loading.tsx`, `not-found.tsx` exist at the app root; add
screen-specific ones next to a route when its shape differs.

### Conventions

- **Dates:** always format through `src/lib/date.ts`, which pins **both** locale
  and timezone. Never call `toLocaleDateString()` in a component. Unpinned it
  resolves to the host (en-US server / en-GB browser, in two zones), server and
  client disagree on the day, and React throws a hydration mismatch. This product
  is made of dates. Use `relativeDay(target, today)` for "in 3 days".
- **Status idiom:** a Badge *whispers* (tinted, inline status), an Alert *speaks
  up* (`variant="warning"` etc., tinted + bordered, a message to read), a
  destructive Button *shouts* (solid). Pick by volume.
- **Tables on a phone:** a 4-column table doesn't fit 375px. Render a `<Table>`
  from `md` up and a stack of `<Card>`s below, from the same data. The pattern is
  in `/styleguide` under "Table, and the phone fallback".
- **Forms:** `Field` + `react-hook-form` + `zod`; non-native inputs (Select,
  Calendar) go through `Controller`. Worked example in `/styleguide`. shadcn's
  `form` is an empty stub in this style, and `field` replaced it.
- **Admin screens:** start with `<PageHeader>` inside `<Container>`, and add your
  route to `ADMIN_NAV` in `src/components/admin-shell.tsx`, not your own nav.
- **Buttons and inputs** are one size step larger than stock shadcn (default 40px,
  `lg` 44px; icon buttons `icon-lg` for phone controls). That is a touch target,
  not a preference. Re-running `shadcn add … --overwrite` loses this and the focus
  and status edits below; put them back.
- **Focus** is an offset `outline` in `--ring` (distinct from `--primary`), not a
  box-shadow ring. It survives Windows High Contrast Mode and shows on a clay
  button. Keep `outline-hidden` (not `outline-none`).

### The two layouts

| | `app/(admin)/` | `app/(member)/s/[token]` |
| --- | --- | --- |
| Nav | Sidebar (desktop), drawer (mobile) | **None** |
| Theme toggle | Yes | No, it follows the phone |
| Auth | AuthKit (BLO-1050) | The magic-link token |
| Width | `max-w-5xl` | `max-w-lg`, single column |

They are opposites on purpose. A member is not logged in, did not ask to be there,
and has exactly one thing to do.

The magic-link token stays on this side of the wire: read it server-side and
forward it to Rails as `Authorization: Bearer <token>`, **never** as a path
segment. Rails logs paths verbatim, and the token never expires.
