# SOLSTICE — the design direction

## The concept

Solstice is the longest, brightest day of the year, and this is a chore rota
that feels like one: a delightful consumer app, not enterprise software. The
page is sunlit paper (never white, never grey), the ink is deep violet (never
black, never slate), and a small choir of candy-bright hues each carries a
meaning rather than one lone accent carrying everything. Corners are pillowy,
everything tappable is a pill, shadows are soft and violet-tinted so the UI
feels lit rather than printed, and motion has a spring in its step — cards rise
and settle, buttons lift and squash, empty states gently bob. The member page
is the emotional hero: someone opens it from a text, standing in a kitchen, and
it greets them by name in a warm, slightly wonky serif before it asks them to
do anything. Dark mode is a midsummer night — deep plum-navy with an aurora
wash — cozy, never gloomy, same personality after dark.

## The palette

Pigment families (PAINT layer in `src/app/globals.css`; never used directly):

| Family | Role | Light register | Dark register |
| --- | --- | --- | --- |
| **Sunbeam** | warm whites: page, cards, cream panels, butter hairlines | `oklch(0.977 0.017 92)` page, `oklch(0.996 0.006 95)` card | — |
| **Twilight** | violet inks and night surfaces | `oklch(0.29 0.05 292)` text | `oklch(0.208 0.038 292)` page, `oklch(0.255 0.043 292)` card |
| **Iris** | the ACTION colour: CTAs, links, focus, active nav, lilac mists (hover tint, sidebar) | `oklch(0.505 0.215 296)` | `oklch(0.77 0.13 296)` |
| **Flamingo** | pure decoration — the pink in every gradient; never a status | `oklch(0.6 0.19 12)` | `oklch(0.78 0.13 12)` |
| **Sunshine** | NOW: warnings, the today/tomorrow pill | `oklch(0.483 0.113 72)` | `oklch(0.85 0.13 88)` |
| **Meadow** | DONE: success, delivered | `oklch(0.47 0.115 152)` | `oklch(0.8 0.14 152)` |
| **Sky** | ON ITS WAY: info, queued, covering | `oklch(0.47 0.115 245)` | `oklch(0.79 0.1 235)` |
| **Cherry** | WENT WRONG: failures, destructive | `oklch(0.515 0.19 20)` | `oklch(0.78 0.135 18)` |

Distinctive semantic choices: `--accent` (the hover tint) blushes **lilac**
instead of grey; `--secondary` is a lilac fill with deep-iris text so "Cancel"
stays friendly; the admin `--sidebar` is a lilac-mist panel — the one full wash
of the brand hue in the chrome.

### Gradients (tokens, light + dark voices)

- `--gradient-sunrise` — gold → pink → lilac (jewel tones in dark). The brand
  wash: wordmark tile, empty-state coins, the shift card's date coin, the
  greeting swash, the styleguide hero.
- `--gradient-cta` — iris → raspberry. Fills every primary button; both stops
  stay AA against the button text; paired with `shadow-primary`, an iris glow.
- `--gradient-page` — barely-there peach + sky radial corners on `<body>`
  (violet/pink aurora in dark).

## The type pairing

- **Fraunces** (`--font-heading`, variable: SOFT 100, opsz) — a warm, optical
  display serif. The voice: greetings, card titles, dialog titles, wordmark,
  section headings. The `font-wonky` utility (WONK 1) is reserved for the
  display greeting — one hand-drawn letterform as a wink.
- **Plus Jakarta Sans** (`--font-sans`) — warm geometric humanist body copy,
  open counters, legible on a phone at arm's length.
- **Space Mono** (`--font-mono`) — machine strings only (tokens, Twilio SIDs),
  with charm.

Rule of thumb: if a sentence does work it's Jakarta; if it smiles it's Fraunces.

## Motion language

Springy, never slick; always a garnish (fully stilled by
`prefers-reduced-motion`).

- Easings: `ease-spring` (`cubic-bezier(0.34, 1.56, 0.64, 1)`) for anything
  that ARRIVES; `ease-out-soft` for fades and colour.
- Named animations: `animate-pop` (dialog entrance), `animate-rise` (list
  items, staggered ~70–90ms per item — the member shift list uses this),
  `animate-float` (idle bob on decorative coins). All animate the independent
  `scale`/`translate` properties so they compose with layout transforms.
- Buttons: hover lifts (−2px + bigger glow), press squashes (scale 0.97),
  release bounces back on the spring.

## Borders, radius, elevation

- `--radius: 1.25rem` (20px) — a full tier rounder than before. Cards at
  `rounded-xl` (26px), dialogs and date coins at `rounded-2xl` (34px), and
  **everything tappable is a pill** (`rounded-full` buttons, inputs, selects,
  badges).
- Borders stay hairline and decorative (`--border` is butter / twilight in
  dark); `--input` is the one 3:1 control boundary.
- Shadows are **soft and violet** (`oklch(0.35 0.09 296 / …)`ambient + key),
  deepening to true night in dark. `shadow-primary` / `shadow-primary-lg` are
  the iris glow reserved for CTAs.

## The five signature moves

1. **The sunrise date coin** — every shift renders as a page-a-day calendar
   leaf on a gradient coin; the coin's colour carries the cover state (sunrise
   = yours, sky = covering, muted = handed off).
2. **Pills with a pulse** — gradient CTA pills that glow iris, lift on hover,
   squash on press, and bounce back on a spring.
3. **The lilac blush** — hover states tint toward iris instead of grey, so the
   interface warms wherever you touch it.
4. **Fraunces greets you** — `Hi Alice` in the wonky cut over a sunrise swash;
   the product speaks like a note on the fridge, not a heading in a dashboard.
5. **Staggered arrivals** — lists rise and settle card by card
   (`animate-rise` + delay), and empty states float on a bobbing gradient coin.

## Architecture notes

Everything flows through the three-layer token system in
`src/app/globals.css` (PAINT → SEMANTIC → UTILITY); `npm run check:tokens`
verifies WCAG AA (4.5:1 text, 3:1 controls) for every pairing in BOTH themes,
with translucent fills composited over their real backdrops. The pigment
families in the checker's PAINT regex were renamed to match
(`sunbeam|twilight|iris|flamingo|sunshine|meadow|sky|cherry`).
