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

Config comes from the **single `.env` at the repo root** — not from `apps/web/.env`.
`next.config.ts` points dotenv at `../../.env`, the same file
`apps/api/config/application.rb` reads. Copy `.env.example` to `.env` at the repo
root once and both apps are configured.

## The gate

```bash
npm run ci         # lint + typecheck + check:tokens + build
```

Exactly what CI runs. `bin/ci` is the Rails half.

`npm run check:tokens` is the one that will surprise you: it reads `globals.css`
and fails if a semantic token is defined for light but never redefined for dark
(it would silently inherit the light value), or if any foreground/background
pairing drops below WCAG AA in either theme.

## The design system

**Open `/styleguide`.** Every token and every component is rendered there, in both
themes, with a note on what each is *for*. That page is the reference; this file
only lists the rules that are easy to break by accident.

### Three rules

1. **Never a raw colour in a component.** No hex, no `oklch()`, no `bg-orange-500`.
   The raw pigments in `globals.css` are deliberately kept *outside* Tailwind's
   `@theme`, so no `bg-clay-500` utility is ever generated — the escape hatch does
   not exist. ESLint fails the build on `bg-[#b45024]` and on inline colour styles.
2. **One accent.** Clay, via `--primary`. A second saturated colour on a screen
   means something has gone wrong. Status colours are the only exception, and only
   for status.
3. **Mobile first.** The member page is a phone page that happens to work on
   desktop. Design at 375px.

### Tokens that are easy to get wrong

| Token | It is |
| --- | --- |
| `--primary` | The clay accent. CTAs, links, focus. **This is the brand colour.** |
| `--accent` | *Not* the brand colour — shadcn's subtle hover tint. Name inherited from shadcn. |
| `--border` | Decorative hairline: card edges, separators. Low contrast on purpose. |
| `--input` | A real control boundary — form fields. Darker, because WCAG wants 3:1 here. |
| `--success` / `--warning` / `--info` | HouseRota additions, for the SMS delivery log. `<Badge variant="success">`. |

### Conventions

- **Dates:** always format through `src/lib/date.ts`. Never call
  `toLocaleDateString()` in a component — with no locale it resolves to the host
  default (`en-US` on the Node server, `en-GB` in the browser), the two disagree,
  and React throws a hydration mismatch. This product is made of dates.
- **Forms:** `Field` + `react-hook-form` + `zod`; non-native inputs (Select,
  Calendar) go through `Controller`. Worked example in `/styleguide`. Note that
  shadcn's `form` component is an empty stub in this style — `field` replaced it.
- **Admin screens:** start with `<PageHeader>`, and add your route to `ADMIN_NAV`
  in `src/components/admin-shell.tsx` rather than building your own navigation.
- **Buttons and inputs** are one size step larger than stock shadcn (default 40px,
  `lg` 44px). That is a touch target, not a preference. Re-running
  `shadcn add button --overwrite` will lose it; put it back.

### The two layouts

| | `app/(admin)/` | `app/(member)/s/[token]` |
| --- | --- | --- |
| Nav | Sidebar (desktop), drawer (mobile) | **None** |
| Theme toggle | Yes | No — follows the phone |
| Auth | AuthKit (BLO-1050) | The magic-link token |
| Width | `max-w-5xl` | `max-w-lg`, single column |

They are opposites on purpose. A member is not logged in, did not ask to be there,
and has exactly one thing to do.

The magic-link token stays on this side of the wire: read it server-side and
forward it to Rails as `Authorization: Bearer <token>`, **never** as a path
segment — Rails logs paths verbatim, and the token never expires.
