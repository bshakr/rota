/**
 * "6 turns", "1 turn", "No turns": what the Next week header says it is holding.
 *
 * The header is read CLOSED, on its own, and is the only thing a collapsed section
 * offers, so it has to be a sentence a person would say out loud. "0 turns" is a
 * database row; "No turns" is the answer to the question the admin actually asked.
 */
export function turnsLabel(count: number): string {
  if (count === 0) return "No turns";
  return count === 1 ? "1 turn" : `${count} turns`;
}
