# Rota Monster — Soft Clay design

Status: approved by Bassem on 2026-09-12 (direction C of four, canvas:
https://claude.ai/code/artifact/902b8a14-ecaf-493e-8dec-ea7271069971).
Supersedes the Solstice direction in `apps/web/DESIGN-DIRECTION.md`, which
this work rewrites.

## 1. What changes

The app is branded **Rota Monster**, living at **rota.monster**. The web app
gets a ground-up visual identity called **Soft Clay**: lavender paper, plum
ink, one grape action colour, a family of pastel tints, pillowy surfaces lit
from above and squashed below, a rounded display face, and a voice that sounds
like a housemate rather than a product. Every route in `apps/web` is restyled.
The logo is deferred: the wordmark is plain type until a mark exists.

This visual-design phase excluded internal identifiers. The later codebase rename
updates the Rails module to `RotamonsterApi` and the npm package to `@rotamonster/web`.
Database names, the Postgres role, and database connection variables stay unchanged.
The API changes are two copy touches (mailer from-address, seed SMS template).

## 2. Name, voice, cast

- **Name in prose:** Rota Monster (two words, capitals). **Wordmark and URL:**
  `rota.monster`, lowercase. Page titles: `"%s · Rota Monster"`, default
  `"Rota Monster"`. Description: `"Whose turn? Sorted."`.
- **Voice:** human, light-hearted, fun. Short sentences. Sounds like a note
  from a housemate, not a product. Gentle, never sarcastic at the user.
  British spelling as the codebase already uses ("colour", "organise").
- **Hard rules:** no em dashes (`—`) and no en dashes used as em dashes
  anywhere a user can read, including SMS templates, empty states, errors,
  toasts, form hints and the README's product description. Use a full stop, a
  comma or a colon instead. At most one emoji, and only inside an SMS
  template. No exclamation marks in a row. Don't say "seamless", "effortless",
  "delightful" or similar.
- **Cast for every example:** Bass, Eliza, Raph, Ciara. Chores: Bins, Kitchen
  deep clean, Bathroom. Ciara receives the example text and the member
  greeting ("Hi Ciara"). Raph has Saturday's kitchen clean. No other names.
- **Reference copy** (from the approved board; adapt, don't pad):
  - Landing badge: "Gently nags. Never bites."
  - Landing headline: "Whose turn? Sorted."
  - Landing sub: "Set the chores up once. Rota Monster texts whoever's up
    next, and handing a turn on is one tap. Nobody has to nag."
  - Landing CTA: "Set up your house" · note "Two minutes, promise."
  - Example SMS: "Hi Ciara 🌷 you're up for Kitchen deep clean this Saturday.
    Can't make it? Tap to hand it on."
  - Member greeting: "Hi Ciara" · "Here's what's coming up for you, across
    every rota."
  - Empty state: "No rotas yet" · "Add the first chore and who takes turns.
    We'll handle the reminders."

## 3. Colour

Three-layer token system stays (PAINT → SEMANTIC → UTILITY in
`apps/web/src/app/globals.css`). Every value is replaced. Semantic names stay
so components keep compiling: `--background --foreground --card
--card-foreground --popover --popover-foreground --primary
--primary-foreground --secondary --secondary-foreground --muted
--muted-foreground --accent --accent-foreground --success --warning --info
--destructive --destructive-foreground --border --input --ring --overlay
--elevation-xs/sm/md/lg --sidebar* --chart-1..5 --radius`. Removed:
`--gradient-sunrise`, `--gradient-page`, `--elevation-primary*`, the Solstice
paint families. Any component using a removed token is restyled (grep
`gradient-sunrise`).

### Paint families (light register)

| Family | Role | Value |
| --- | --- | --- |
| Lavender | paper | `#F5F1FF` page · `#FFFFFF` card · `#E9E3FF` hero/pane · `#EDE8FF` quiet fill |
| Plum | ink | `#34244D` text (oklch 0.30 0.075 300) · muted text `#6F6089` · hairline `rgba(52,36,77,0.12)` · input boundary `rgba(52,36,77,0.35)` |
| Grape | action | `#6334CB` primary (oklch 0.48 0.215 290) · `#5325AF` pressed/ring · lilac `#E0D7FF` as the quiet secondary fill |
| Mint | done / success | `#B3EECD` |
| Peach | warm decoration, date coins | `#FFD2AF` · deep `#FFC091` |
| Lemon | now / warning | `#F9E8A7` |
| Sky | on its way / info | `#B8E5FF` |
| Blush | went wrong / destructive tint | `#FFCEE0` |

All pastels are one OKLCH family: L 0.90, C 0.06–0.085, hue only moving
(mint 160, peach 55, lemon 95, lilac 295, blush 355, sky 235). Verified on the
board: ink on paper 12.6:1, muted on paper 5.1:1, white on grape 7.3:1, ink on
every tint ≥ 8.8:1.

### Semantic mapping (light)

- `--background` lavender page · `--card`/`--popover` white · `--foreground`
  plum ink · `--muted` quiet fill `#EDE8FF` · `--muted-foreground` `#6F6089`.
- `--primary` grape, `--primary-foreground` white. `--secondary` lilac with
  `--secondary-foreground` plum. `--accent` (hover tint) lilac at half
  strength, `--accent-foreground` plum.
- Status is a **tint with plum text**: `--success` mint, `--warning` lemon,
  `--info` sky, `--destructive` blush for tints; a saturated destructive for
  real destructive buttons (`oklch(0.55 0.2 15)` with white text).
- `--border` hairline plum 12% · `--input` plum 35% · `--ring` `#5325AF` ·
  `--overlay` plum 55%.
- `--sidebar` white, `--sidebar-primary` grape.

### Dark register ("clay at night")

Deep plum, same pastels as tints, same personality after dark. Starting
values; the implementer tunes until `npm run check:tokens` passes for every
pairing in both themes:

- page `oklch(0.235 0.055 300)` · card/panel `oklch(0.29 0.055 300)` · quiet
  fill `oklch(0.34 0.05 300)` · foreground `oklch(0.96 0.015 300)` · muted
  foreground `oklch(0.78 0.03 300)` · border `oklch(0.38 0.05 300)`.
- Primary stays grape `#6334CB` with white text (fill contrast is
  theme-independent). Links and accents on dark use lifted grape
  `oklch(0.8 0.12 290)`.
- Tints on dark: the pastel as the **text** colour on a 16% alpha fill of
  itself over the panel (the checker composites translucent fills over their
  real backdrop).
- Clay shadows on dark: highlight `rgba(255,255,255,0.08)`, squash
  `rgba(0,0,0,0.35)`, drop is true night.

## 4. Type

- **Fredoka** (`--font-heading`, variable, weight 600 default, width axis
  `wdth` 108 so headlines look pressed and pillowy): greetings, headings,
  card titles, dialog titles, wordmark, buttons, date numerals.
- **Outfit** (`--font-sans`, variable 400–700): body, tables, forms, labels.
- **Space Mono** (`--font-mono`): machine strings only (tokens, Twilio SIDs).
- Load via `next/font/google` in `layout.tsx` (Fredoka with `axes: ["wdth"]`).
  Real fallback stacks. The `font-wonky` utility and every use of it go.
- Scale: keep the existing utilities; `text-display` becomes 2.75rem / 1.05 /
  -0.02em.

## 5. Shape, elevation, motion

- **Radius:** controls (buttons, inputs, selects, badges, chips, tabs
  triggers, menu items) are pills (`rounded-full`); cards 24px; dialogs,
  sheets, popovers and panels 28px; the admin sidebar panel and hero band 32px;
  date coins 18px; avatars and dots full. Set `--radius: 0.75rem` and use
  explicit classes where the ramp doesn't reach.
- **Clay recipe** (replaces the violet shadows; wire to `--elevation-*` so
  `shadow-xs/sm/md/lg` pick it up):
  - soft (`xs`): `inset 0 1px 0 rgba(255,255,255,0.9), inset 0 -3px 0 rgba(52,36,77,0.08)`
  - card (`sm`): `inset 0 2px 0 rgba(255,255,255,0.95), inset 0 -5px 0 rgba(52,36,77,0.07), 0 22px 34px -22px rgba(52,36,77,0.38), 0 2px 6px -3px rgba(52,36,77,0.08)`
  - lift (`md`): `inset 0 2px 0 rgba(255,255,255,0.95), inset 0 -6px 0 rgba(52,36,77,0.06), 0 30px 48px -26px rgba(52,36,77,0.4), 0 4px 10px -4px rgba(52,36,77,0.08)`
  - `lg`: lift with the drop at 0.5 alpha.
  - Primary button: `inset 0 2px 0 rgba(255,255,255,0.35), inset 0 -4px 0 rgba(0,0,0,0.2), 0 16px 26px -12px rgba(99,52,203,0.7)`.
  Nothing grey anywhere; every shadow carries plum.
- **Blobs:** organic pastel shapes (`border-radius: 58% 42% 45% 55% / 55% 48%
  52% 45%` style) with the clay recipe, behind the landing hero and the
  dashboard hero only. They bob (`animate-bob`, 6s ease-in-out, translate
  only) and are stilled by `prefers-reduced-motion`.
- **Motion:** keep `ease-spring`, `animate-pop`, `animate-rise` (staggered
  lists). Buttons lift 1px on hover and squash (`scale 0.97`) on press.
- No gradients as fills. No frosted glass. No left-border accent cards.

## 6. Components (`apps/web/src/components`)

- **button:** pill. `default` = grape fill, white label, primary clay shadow,
  hover lifts and deepens to `#5325AF`. `secondary` = lilac fill, plum label,
  soft clay. `outline` = white fill, plum 35% border. `ghost` = transparent,
  hover lilac blush. `destructive` = saturated destructive, white label.
  `link` = grape underline. Sizes keep their heights; horizontal padding grows
  by 4px for the pill.
- **badge:** pill tint with plum text; `outline` is a hairline pill.
- **card:** white, 24px, card clay. **dialog/sheet/popover/dropdown:** 28px,
  lift clay, overlay plum 55%. **input/select/field:** pill, white, `--input`
  border, ring on focus; height unchanged. **tabs:** pill list with a white
  clay pill for the active tab. **table:** hairline rows, plum-12% rules,
  header in Outfit 600 small caps; no zebra. **alert:** tint fill by tone,
  plum text, 20px radius. **avatar:** full, pastel tint from `avatar-tint`.
  **skeleton:** quiet fill pill. **sonner toasts:** white clay, 20px.
  **separator:** plum 12%.
- **empty-state:** peach clay coin (56px, 18px radius, floats) holding the
  icon; title in Fredoka; body in Outfit.
- **wordmark:** plain type. `rota` in plum, `.monster` in grape, Fredoka 700,
  wdth 110, -0.03em. `muted` variant is all muted text. No icon tile.
- **page-header, container, placeholder, confirm-dialog, theme-toggle:**
  restyled to the above.

## 7. Every route

| Route | What it must look like after |
| --- | --- |
| `/` (landing) | Board copy (§2). Hero on the `#E9E3FF` pane with two or three bobbing blobs; vignette pane with the peach date coin, the week rows (Bins Tue Bass, Bathroom Thu Eliza), the example SMS to Ciara. Feature trio and closing CTA restyled. Footer wordmark muted. |
| `/dashboard` | Hero band restyled (blobs, no gradient), week glance with peach/lemon/lilac day coins (today peach, tomorrow lemon, later lilac), upcoming list cards, override dialog. Copy: "Rota Monster texts whoever's up". |
| `/members` (+ loading) | Table and add/edit dialogs restyled; skeleton pills. Example names in any empty/help copy from the cast. |
| `/rotas` | List cards restyled, empty state with the peach coin. |
| `/rotas/new`, `/rotas/[id]` | Editor: pill inputs, roster drag list as clay chips, live preview cards, schedule warning as a lemon alert. |
| `/shifts` | Table + override affordances restyled. |
| `/sms` | Delivery log table; status badges mint (delivered), sky (queued), blush (failed), lemon (pending). |
| `/s/[token]` (+ loading) | The emotional hero: greeting "Hi Ciara" in Fredoka, shift cards with the peach date coin (sky when covering, quiet when handed off), pill actions, cover dialog. Invalid-link state restyled. |
| `/styleguide` | Rewritten to document Soft Clay: swatches, type, shapes, the clay recipe, every component and both themes. |
| `error.tsx`, `not-found.tsx`, `loading.tsx` | Restyled; copy in voice ("That page wandered off." / "Something went wrong on our side. Try again in a moment."). |
| Admin shell (sidebar, nav) | White clay panel, pill nav items, active item lilac fill with grape icon, wordmark top-left, theme toggle and sign-out restyled. |

"Looks good" means: no Solstice leftovers (gradients, violet shadows,
Fraunces), consistent radii, AA contrast in both themes, nothing overflowing at
390px wide on the member page, and the copy rules in §2.

## 8. Metadata, favicon, theme colour

- `layout.tsx` metadata: title template and description per §2; `themeColor`
  `#F5F1FF` light / `oklch(0.235 0.055 300)` dark (as hex).
- `icon.svg`: placeholder until the logo. A 32×32 lavender `#E9E3FF` tile
  with 9px radius holding a single grape `#6334CB` dot (r 6) at the optical
  centre, with the clay highlight/squash drawn as two thin arcs. Comment says
  it is a placeholder for the mark.
- `theme-color-meta.tsx` updated to the new paper colours.

## 9. Records and copy outside the app

- `apps/web/DESIGN-DIRECTION.md` rewritten as "SOFT CLAY — the design
  direction" with the same section shape as before (concept, palette, type,
  motion, shape, signature moves, architecture notes), matching what shipped.
- `README.md`: title and product description use Rota Monster; the design
  spec link points at this file; clone/db names unchanged.
- `apps/api/db/seeds.rb`: default SMS template in voice, one emoji at most.
- `apps/api/app/mailers/application_mailer.rb`: from `hello@rota.monster`.
- `.env.example` comments: example URLs use `rota.monster`.

## 10. Testing and acceptance

- `npm run check:tokens` passes for every pairing in both themes; its PAINT
  regex is updated to `lavender|plum|grape|mint|peach|lemon|sky|blush|lilac`.
- `npm run lint`, `npm run typecheck`, `npm test`, `npm run build` pass.
- A grep for `—` under `apps/web/src` returns only code comments.
- Before/after screenshots of every route in §7 that can be rendered without a
  WorkOS session (landing, styleguide, member page, not-found) in both themes,
  plus admin routes if a local sign-in is available; published as a gallery
  and linked from the PR.

## 11. Implementation waves

Wave 1, one agent (foundation, everything depends on it): `globals.css`,
`layout.tsx` (fonts, metadata), `scripts/check-theme-parity.mjs`, `icon.svg`,
`theme-color-meta.tsx`, `wordmark.tsx`; remove `font-wonky` and gradient
tokens; keep the app compiling; `check:tokens` green in both themes.

Wave 2, five agents in parallel, disjoint files:

1. Primitives: `components/ui/*`, `empty-state`, `confirm-dialog`,
   `page-header`, `placeholder`, `container`, `theme-toggle`.
2. Admin: `(admin)/layout.tsx`, `admin-shell`, `admin/sign-out-button`,
   dashboard (+ `_components`), members (+ loading), rotas (list, new, `[id]`,
   `_components`), shifts, sms.
3. Member: `(member)/layout.tsx`, `s/[token]` page + loading + shift-list,
   `member/shift-card`, `member/invalid-link`.
4. Landing and system pages: `page.tsx`, `_components/landing.tsx`,
   `error.tsx`, `not-found.tsx`, `loading.tsx`.
5. Styleguide and records: `styleguide/*`, `DESIGN-DIRECTION.md`, `README.md`,
   `seeds.rb`, `application_mailer.rb`, `.env.example`.

Wave 3: verification (§10), screenshot capture, review, PR.
