// Every person gets a sticker from the pastel sheet, picked by name so it is
// stable across visits and screens (the dashboard's week glance and the
// sidebar's account footer show the same Ciara in the same mint).
//
// A WASH, not a solid fill, and 25% is chosen rather than guessed: the pastels
// all sit at OKLCH lightness 0.90, so a quarter-strength wash lands near-white
// over a white card and near-plum over a night panel. Initials therefore stay in
// --foreground and clear 4.5:1 in BOTH themes, which a solid pastel could not do
// (white initials on mint is the failure this avoids).
const AVATAR_TINTS = [
  "bg-mint/25",
  "bg-peach/25",
  "bg-lemon/25",
  "bg-sky/25",
  "bg-blush/25",
  "bg-lilac/25",
] as const;

export function avatarTint(seed: string): string {
  let hash = 0;
  for (const ch of seed) hash = (hash * 31 + (ch.codePointAt(0) ?? 0)) % 9973;
  return AVATAR_TINTS[hash % AVATAR_TINTS.length];
}
