# SOFT CLAY — the design direction

## The concept

A chore rota should feel like a fridge magnet, not enterprise software. Soft
Clay is lavender paper, plum ink, one grape action colour, and a sheet of
pastel stickers that each carry a meaning. Surfaces are pillowy: lit from above
with a white inset highlight, squashed below with a plum inset shadow, and
dropped onto the page with a long, soft plum shadow. Nothing is grey. Nothing
is a gradient. There is no frosted glass and no left-border accent card.

Everything tappable is a pill. Cards sit at 24px, dialogs and panes at 28px,
the sidebar and the hero band at 32px, date coins at 18px. The display face is
Fredoka, set wide and heavy enough that a headline looks pressed out of clay
rather than typed.

The member page is the emotional hero. Someone opens it from a text, standing
in a kitchen, not signed in and not having asked to be there, so it greets them
by name in Fredoka before it asks them to do anything.

Dark mode is clay at night: deep plum instead of lavender, the same pastels,
the same personality. The grape button is pixel identical in both registers,
because a fill carries its own contrast.

## The name, the voice, the cast

**Rota Monster** in prose, two words and capitals. **rota.monster** lowercase
for the wordmark and the URL. Page titles are `"%s · Rota Monster"` with the
default `"Rota Monster"`, and the description is `"Whose turn? Sorted."`.

The voice is human and light-hearted. Short sentences. It sounds like a note
from a housemate, not a product. Gentle, and never sarcastic at the person
reading it. British spelling, as the codebase already uses.

Hard rules, and they apply everywhere a user can read: SMS templates, empty
states, errors, toasts, form hints and the README's product description.

- No em dashes, and no en dashes standing in for one. Use a full stop, a comma
  or a colon.
- At most one emoji, and only inside an SMS template.
- No exclamation marks in a row.
- Never "seamless", "effortless", "delightful" or their relatives.

Every example in the product uses the same cast: **Bass, Eliza, Raph, Ciara**,
and the same three chores: **Bins, Kitchen deep clean, Bathroom**. Ciara
receives the example text and the member greeting. Raph has Saturday's kitchen
clean. No other names, so a screenshot from one screen always matches the next.

## The palette

Pigment families (the PAINT layer in `src/app/globals.css`, never used directly
by a component):

| Family | Role | Light register | Dark register |
| --- | --- | --- | --- |
| **Lavender** | paper: page, cards, panes, quiet fills | `#F5F1FF` page, `#FFFFFF` card, `#E9E3FF` pane, `#EDE8FF` quiet fill | plum takes the paper job |
| **Plum** | ink by day, the whole sky at night | `#34244D` ink, `#6F6089` muted text | `oklch(0.235 0.055 300)` page, `oklch(0.29 0.055 300)` card, `oklch(0.34 0.05 300)` quiet fill, `oklch(0.96 0.015 300)` text |
| **Grape** | the one action colour | `#6334CB` fill, `#5325AF` pressed and focus ring | fill unchanged, `oklch(0.8 0.12 290)` for anything grape doing a text job |
| **Lilac** | grape gone quiet: secondary, hover blush, the later day coin | `#E0D7FF` secondary, `oklch(0.945 0.03 296)` hover | `oklch(0.36 0.07 295)` secondary, `oklch(0.32 0.06 295)` hover |
| **Mint** | DONE: delivered, a turn taken | `#B3EECD` | the pastel becomes the text on a 16% wash of itself |
| **Peach** | warmth and date coins | `#FFD2AF`, `#FFC091` deep | unchanged, a sticker does not invert |
| **Lemon** | NOW: warnings, tomorrow's coin | `#F9E8A7` | pastel as text on a 16% wash |
| **Sky** | ON ITS WAY: queued, covering | `#B8E5FF` | pastel as text on a 16% wash |
| **Blush** | WENT WRONG, plus the real destructive button | `#FFCEE0` sticker, `oklch(0.55 0.2 15)` button | `oklch(0.78 0.2 15)` button with deep plum text |

The six pastels are one OKLCH family: L 0.90, C 0.06 to 0.085, with only the
hue moving (mint 160, peach 60, lemon 95, sky 234, blush 354, lilac 296).
Because they share a lightness, plum ink reads on every one of them at about
10:1, and a sticker looks the same at night as it does by day.

Distinctive semantic choices:

- **`--danger` is not `--destructive`.** The blush sticker that says a text
  failed and the saturated button that deletes a member are two different jobs,
  so they are two different tokens. Reach for `bg-danger` on a tint and
  `bg-destructive` only on a button that has to shout.
- **`--link` is not `--primary`.** Primary is a FILL and stays grape in both
  registers. Link is the same colour doing a TEXT job and lifts at night, so
  links, icons and quiet labels use `text-link`.
- **`--accent` is the hover tint, and it blushes lilac** rather than going
  grey. A hovered row glows faintly grape.
- **`--secondary` is a lilac fill with plum ink**, so "Cancel" reads friendly
  instead of administrative.
- **Status is a sticker.** `bg-success text-success-foreground` is correct in
  both registers: by day the pastel is the fill and plum is the text, and at
  night the fill drops to a 16% wash of itself and the pastel becomes the text.
- **`--border` and `--input` are not the same line.** Border is a decorative
  hairline at plum 12%. Input is a real control boundary that has to clear 3:1,
  and it is carried at plum 55% rather than the 35% the board proposed, which
  measured 2.1:1 over the quiet fill.

### Gradients

There are none. Not on a button, not behind a hero, not on a coin. Colour
arrives as flat pastel and depth arrives as clay. The one place a shape earns
some organic softness is a blob, and a blob is still a flat fill.

## The type pairing

- **Fredoka** (`--font-heading`, variable, with a `wdth` axis). Set at weight
  600 and `wdth` 108 by the `.font-heading` base rule, which is where the
  letterforms go pillowy. It carries greetings, headings, card titles, dialog
  titles, buttons, date numerals and the wordmark.
- **Outfit** (`--font-sans`, variable 400 to 700). Body copy, tables, forms and
  labels. A clean geometric sans whose round bowls sit under Fredoka without
  competing.
- **Space Mono** (`--font-mono`). Machine strings only: magic-link tokens and
  Twilio SIDs.

Rule of thumb: if a sentence does work it is Outfit, and if it smiles it is
Fredoka. `text-display` is 2.75rem / 1.05 / -0.02em, and it belongs to the
member greeting and the landing headline.

## Motion language

Springy, never slick, and always a garnish. `prefers-reduced-motion` stills all
of it, and the idle bob is stopped outright rather than sped up so a blob
simply sits where it is.

- Easings: `ease-spring` (`cubic-bezier(0.34, 1.56, 0.64, 1)`) for anything
  that ARRIVES, `ease-out-soft` for fades and colour. Durations are 150 to
  250ms for feedback and 400 to 500ms for entrances.
- Named animations: `animate-pop` for dialogs and a hero's first paint,
  `animate-rise` for list items staggered about 90ms apart, `animate-bob` for
  the slow 6s drift on decorative blobs and coins. The bob translates only, so
  nothing wobbles.
- All three animate the independent `scale` and `translate` properties rather
  than `transform`, so they compose with layout transforms and a dialog's
  centring survives its own entrance.
- Buttons lift 1px on hover and squash to `scale 0.97` on press, then bounce
  back on the spring.

## Borders, radius, elevation

- `--radius: 0.75rem`. The ramp reaches the sizes the system actually uses:
  `sm` 6px for the smallest garnish, `md` 9px for a chip nested in a control,
  `lg` 12px as the base step, `xl` 18px for date coins and empty-state coins,
  `2xl` 24px for cards, `3xl` 28px for dialogs, sheets, popovers and panes,
  `4xl` 32px for the admin sidebar panel and the hero band.
- **Controls are pills.** Buttons, inputs, selects, badges, chips, tabs
  triggers and menu items are `rounded-full`, not a step on that ramp. So are
  avatars and status dots.
- Borders stay hairline and decorative. `--input` is the one boundary that
  carries a contrast requirement.
- **The clay recipe** is wired to `--elevation-*`, so `shadow-xs`, `shadow-sm`,
  `shadow-md` and `shadow-lg` pick it up:
  - `xs` soft: a white inset highlight and a 3px plum inset squash. Chips,
    coins, the things that barely lift.
  - `sm` card: a deeper highlight and squash plus a long plum drop. Cards, list
    rows, toasts.
  - `md` lift: the same, carried further. Dialogs, popovers, a hovered card.
  - `lg`: lift, with the drop at half alpha again, for the biggest panels.
  - `shadow-grape`: the primary button, and nothing else. The highlight and
    squash are drawn inside the grape fill and the drop is grape too, so the
    button looks pressed out of the material it sits on.
- At night the highlight falls to 8% white, the squash goes black at 35%, and
  the drop becomes true night.

## Logo

**Deferred.** Rota Monster has no mark yet, and a placeholder glyph would be
worse than none. The wordmark is type only: `rota` in ink and `.monster` in the
action colour, Fredoka 700 at `wdth` 110 with the letters pulled to -0.03em,
lowercase always, matching the URL. Its `muted` variant drops both halves to
muted text, for the member page where the brand is a reassurance that the link
is legitimate rather than a logo to admire. `icon.svg` is likewise a
placeholder: a lavender tile holding a single grape dot with the clay
highlight and squash drawn as two thin arcs.

## The five signature moves

1. **The peach date coin.** Every shift renders as a page-a-day calendar leaf
   on an 18px peach coin. On the member page the coin carries cover state:
   peach for a turn that is yours, sky when you are covering, quiet fill once
   you have handed it on. On the dashboard the same coin carries urgency
   instead: peach today, lemon tomorrow, lilac later.
2. **Buttons pressed out of clay.** Pill CTAs on a grape fill with the
   highlight and squash drawn inside them, lifting on hover and squashing on
   press.
3. **The lilac blush.** Hover states tint toward grape instead of grey, so the
   interface warms wherever you touch it. Even the text selection is lilac.
4. **Fredoka greets you.** "Hi Ciara" at display size. The product speaks like
   a note on the fridge, not a heading in a dashboard.
5. **Blobs and staggered arrivals.** Organic pastel shapes bob slowly behind
   the landing and dashboard heroes, and lists rise and settle card by card.

## Architecture notes

Everything flows through the three-layer token system in
`src/app/globals.css`: PAINT, then SEMANTIC, then UTILITY. The boundary is the
point. Pigments are defined outside `@theme`, so no `bg-grape-500` utility is
ever generated, and a `@theme` reset (`--color-*: initial`) tears Tailwind's
own palette out of the compiler so `bg-red-500` generates nothing either. Lint
closes the remaining gaps: arbitrary hex and `oklch()` values, and any stray
palette utility.

`@theme inline` republishes the semantic layer so one class resolves correctly
on both sides of the `.dark` boundary. It also publishes a short list of
pastels by name (`bg-mint`, `bg-peach`, `text-plum`). Those are DECORATION and
are deliberately theme independent, because a peach date coin with plum
numerals is a physical object and a sticker does not invert. Pair a pastel fill
with `text-plum`, never with `text-foreground`.

`npm run check:tokens` verifies WCAG AA for every pairing in both registers,
4.5:1 for text and 3:1 for controls and focus rings, with translucent fills
composited over their real backdrops. Its PAINT regex names the families
(`lavender|plum|grape|mint|peach|lemon|sky|blush|lilac`).

The live reference is `/styleguide`, which documents the pigment set, the
semantic tokens, the type, the radius ramp, the clay recipe and every component
variant, in both registers.
