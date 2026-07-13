/**
 * Presentation helpers for the two things this product is made of: people's
 * names and small counts. Centralised so five screens render "Alice" and
 * "+2 more" the same way, rather than each writing their own `.slice(0, 2)`.
 */

/**
 * Up to two initials for an avatar fallback. Takes the first letter of the first
 * and last whitespace-separated parts, so "Alice" -> "A", "Alice Smith" -> "AS",
 * "  mary-jane watson " -> "MW". Never throws on empty input.
 */
export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  const first = parts[0][0] ?? "";
  const last = parts.length > 1 ? (parts[parts.length - 1][0] ?? "") : "";
  return (first + last).toUpperCase();
}

/**
 * A rota can have twenty people; a shift card cannot show twenty names. Render
 * the first `max` and a quiet "+N" remainder: `["Alice","Bob","Cara","Dave"]`
 * with max 2 -> "Alice, Bob +2". Callers style the remainder however they like;
 * this only decides the words.
 */
export function nameList(names: string[], max = 3): string {
  if (names.length <= max) return names.join(", ");
  const shown = names.slice(0, max).join(", ");
  return `${shown} +${names.length - max}`;
}

/**
 * "today" -> "Today". First letter upper, the rest untouched — for sentence-cased
 * labels like `relativeDay`'s output shown as a heading. Centralised so the shift
 * screens don't each keep their own copy.
 */
export function capitalise(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}
