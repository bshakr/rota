/**
 * The timezone list every picker in the product offers.
 *
 * Two surfaces set a house's timezone — the house's own settings form and the
 * operator's "Rename & timezone" dialog — and they must offer the same list for
 * the same reason they share the PATCH semantics: an operator fixing a house's
 * clock and an admin fixing their own are doing one thing, and a zone that only
 * one of the two can choose is a support conversation waiting to happen.
 *
 * Pure and DOM-free, so it can live beside the rest of `lib` and be tested in the
 * node runner.
 */

/**
 * Every IANA zone this JavaScript engine knows, with `current` guaranteed present.
 *
 * The guarantee matters: a stored zone the engine has never heard of (an older
 * browser, or a name a tzdata release retired) would otherwise vanish from the
 * list, and a Radix Select with no matching item renders an EMPTY trigger. The
 * house would look like it had no timezone at all, and saving would silently
 * change it. Keeping it at the head means it preselects, and confirming a correct
 * guess stays one tap.
 *
 * `Intl.supportedValuesOf` is guarded because it is not in every runtime this
 * code is parsed by (it is absent from older Safari, and from the node used by
 * some of the unit tests); falling back to just the current zone keeps the
 * control usable rather than empty.
 *
 * Rails is still the authority — it rejects a zone it does not recognise, and the
 * error comes back to the field.
 */
export function timezoneOptions(current: string): string[] {
  const supported =
    typeof Intl.supportedValuesOf === "function" ? Intl.supportedValuesOf("timeZone") : [];
  return supported.includes(current) ? supported : [current, ...supported];
}
