// Every person gets a hue from the chart choir, picked by name so it is
// stable across visits and screens (the dashboard's week glance and the
// sidebar's account footer share it). A tint, not a solid: initials stay in
// --foreground, so no pairing here depends on an unchecked contrast.
const AVATAR_TINTS = [
  "bg-chart-1/15",
  "bg-chart-2/15",
  "bg-chart-3/15",
  "bg-chart-4/15",
  "bg-chart-5/15",
] as const;

export function avatarTint(seed: string): string {
  let hash = 0;
  for (const ch of seed) hash = (hash * 31 + (ch.codePointAt(0) ?? 0)) % 9973;
  return AVATAR_TINTS[hash % AVATAR_TINTS.length];
}
