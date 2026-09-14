# WorkOS AuthKit in Soft Clay

The sign-in page lives on WorkOS, not in this repo: `apps/web/src/app/auth/sign-in/route.ts`
sends people to the hosted AuthKit page and `/callback` takes them back. So its look is set
in the WorkOS dashboard, and this folder holds the two things that go in there.

- `soft-clay.css`: paste into **Branding > Custom CSS**. It carries the Soft Clay tokens
  from `apps/web/src/app/globals.css` as raw values, because the page cannot read ours.
- The recipe below: the branding editor settings that are not CSS.

Do this once per WorkOS environment (staging and production each have their own branding).

## Branding editor settings

| Setting | Value |
| --- | --- |
| Display name | Rota Monster |
| Logo display | Full logo |
| Full logo (light) | `wordmark-light.png` from the assets handed over with this PR (rota in plum, .monster in grape, transparent) |
| Full logo (dark) | `wordmark-dark.png` (near-white and lifted grape) |
| Logo icon | `icon-512.png` (the placeholder tile from `apps/web/src/app/icon.svg`); swap when the mark lands |
| Favicon | `icon-512.png` |
| Page background, light | `#F5F1FF` |
| Page background, dark | `#1F1A2E` (nearest hex to `oklch(0.235 0.055 300)`) |
| Button background, light and dark | `#6334CB` |
| Button text | `#FFFFFF` |
| Link colour, light | `#6334CB` |
| Link colour, dark | `#B9A3F5` (nearest hex to `oklch(0.8 0.12 290)`) |
| Corner radius | Large / full (the CSS pins pills and 24px anyway) |
| Font family | Outfit (Google Fonts). Fredoka is loaded by the CSS for headings and buttons |
| Dark mode | Follow OS setting |
| Page title | Sign in (default) |
| Last used badge | On |
| Privacy policy | https://rota.monster/privacy |
| Terms of service | https://rota.monster/terms |
| Page layout | Centered, single column |

Then paste `soft-clay.css` into Custom CSS and save. The editor previews every page; check
sign-in, sign-up, magic code and MFA before saving.

## Regenerating the logo files

```bash
# from the repo root; writes wordmark-light.png, wordmark-dark.png, icon-512.png
CID=$WORKOS_CLIENT_ID S=/tmp/authkit CSS=docs/authkit/soft-clay.css \
  ICON=apps/web/src/app/icon.svg node docs/authkit/preview.js
```

`preview.js` also opens the live hosted page in headless Chromium, screenshots it, injects
the CSS plus the wordmark, and screenshots it again, in light and dark at desktop and
phone widths. That is how the before and after pairs in the PR were made, and how to
check a CSS change before pasting it into the dashboard.

## Keeping it in step

When a Soft Clay token changes in `globals.css`, change the matching value at the top of
`soft-clay.css` and re-paste. The class names (`ak-Card`, `ak-PrimaryButton`, ...) come from
the rendered page; if WorkOS renames one, the rule stops applying rather than breaking.
The strapline "Whose turn? Sorted." is CSS-generated text, so it is English only, which
matches the app.
