"use client";

import { useId, useState } from "react";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatRate } from "@/lib/hq-overview";
import {
  type MarginAt,
  type MarginInputs,
  currencySymbol,
  formatMoney,
  lossMakingNote,
  marginSummary,
  parseCandidatePrice,
} from "@/lib/hq-spend";
import { cn } from "@/lib/utils";

/**
 * The margin calculator: type a candidate monthly price, see what it leaves.
 *
 * NOTHING IS STORED AND NOTHING IS IN THE URL. A price typed here is a
 * question, not a decision — an operator trying eight numbers in a row should
 * leave no trace of the seven they rejected, and a `?price=` would turn a
 * half-finished thought into a shareable link and a history entry apiece. It is
 * component state and it dies with the tab.
 *
 * The one Client Component on this page, and the only thing it does that a
 * server could not is respond to a keystroke. Everything it needs arrives as
 * plain numbers in `inputs` — which is also what keeps the payload out of the
 * browser bundle, since bundle-safety.test.ts refuses a Client Component that
 * imports anything under `lib/api/super-admin`.
 *
 * THE MEDIAN IS NOT THE STORY. A price that clears the median house says nothing
 * about the dearest tenth, so p90 is shown beside it and the count of houses
 * that would be loss-making is drawn from every row rather than from either
 * percentile. The arithmetic lives in lib/hq-spend.ts and is tested there
 * (hq-spend.test.ts) — a calculator whose sums are only reviewed by eye is a
 * calculator that sets a price wrong.
 */
export function MarginCalculator({
  inputs,
  currency,
}: {
  inputs: MarginInputs;
  currency: string;
}) {
  const priceFieldId = useId();
  const [typed, setTyped] = useState("");
  const [withFixedCost, setWithFixedCost] = useState(false);

  const price = parseCandidatePrice(typed);
  const summary = price === null ? null : marginSummary(inputs, price, { withFixedCost });

  return (
    <Card>
      <CardHeader>
        <CardTitle>What would a price leave?</CardTitle>
        <CardDescription>
          A monthly price per house, typed here and kept nowhere. Nothing is saved, nothing is in
          the URL.
        </CardDescription>
      </CardHeader>

      <CardContent className="grid gap-5">
        <div className="grid gap-4 sm:grid-cols-[minmax(0,14rem)_auto] sm:items-end">
          <div className="grid gap-1.5">
            <Label htmlFor={priceFieldId}>
              Monthly price per house ({currencySymbol(currency)}, {currency})
            </Label>
            <Input
              id={priceFieldId}
              // `inputMode="decimal"` rather than type="number": a number input
              // swallows a stray scroll as a value change, and its spinners are
              // a trap on a field somebody is typing pounds and pence into.
              inputMode="decimal"
              autoComplete="off"
              placeholder="5.00"
              value={typed}
              onChange={(event) => setTyped(event.target.value)}
            />
          </div>

          {inputs.fixedPerHousePerMonth === null ? null : (
            <div
              className="bg-muted inline-flex rounded-full p-1"
              role="group"
              aria-label="What the margin is measured against"
            >
              {[
                { label: "Variable only", value: false },
                { label: "Plus fixed costs", value: true },
              ].map((option) => (
                <button
                  key={option.label}
                  type="button"
                  aria-pressed={withFixedCost === option.value}
                  onClick={() => setWithFixedCost(option.value)}
                  className={cn(
                    "flex min-h-11 items-center rounded-full px-4 text-sm font-medium transition-colors",
                    "outline-hidden focus-visible:outline-ring focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2",
                    withFixedCost === option.value
                      ? "bg-card text-foreground font-semibold shadow-xs"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {option.label}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* The answer changes as the operator types, with nothing on screen
            moving to announce it: a screen reader would read the field's own
            value back and never the three figures that are the whole point of
            the panel. `polite` rather than `assertive` because it changes on
            every keystroke and must wait for a pause in typing. The region is
            ALWAYS in the tree — a live region that appears at the same moment
            its content does is not announced at all — so the empty prompt and
            the results share one wrapper. */}
        <div aria-live="polite" className="grid gap-5">
          {summary === null ? (
            <p className="text-muted-foreground bg-muted/60 rounded-xl px-4 py-6 text-center text-sm text-pretty">
              Type a price to see the margin it leaves at the median house and at the dearest tenth.
            </p>
          ) : (
            <>
              <dl className="grid gap-3 sm:grid-cols-2">
                <MarginBlock
                  label="At the median house"
                  at={summary.median}
                  price={summary.price}
                  currency={currency}
                />
                <MarginBlock
                  label="At the p90 house"
                  at={summary.p90}
                  price={summary.price}
                  currency={currency}
                />
              </dl>

              <p
                className={cn(
                  "text-sm text-pretty",
                  summary.lossMaking > 0 ? "text-destructive font-medium" : "text-muted-foreground",
                )}
              >
                {lossMakingNote(summary)}
              </p>
            </>
          )}
        </div>

        <p className="text-muted-foreground text-xs text-pretty">
          Margin is a share of the PRICE, not of the cost. Variable cost is texts and Claude, the
          two things this product actually pays for per house.{" "}
          {inputs.fixedPerHousePerMonth === null
            ? "No fixed monthly cost is configured, so hosting, WorkOS and the Twilio number are not in these figures at all."
            : `"Plus fixed costs" adds ${formatMoney(inputs.fixedPerHousePerMonth, currency)} a month, one house's share of hosting, WorkOS and the Twilio number.`}
        </p>
      </CardContent>
    </Card>
  );
}

/**
 * One margin, with the cost it was measured against underneath it.
 *
 * The cost travels with the margin because a margin on its own is unreadable: a
 * pound of margin is wonderful against four pence of cost and a disaster
 * against forty.
 */
function MarginBlock({
  label,
  at,
  price,
  currency,
}: {
  label: string;
  at: MarginAt | null;
  price: number;
  /** The payload's reporting currency, so nothing here carries a hardcoded sign. */
  currency: string;
}) {
  return (
    <div className="bg-muted/60 rounded-xl px-4 py-3.5">
      <dt className="text-muted-foreground text-xs">{label}</dt>
      {at === null ? (
        <dd className="text-muted-foreground mt-1 text-sm">not enough data</dd>
      ) : (
        <>
          <dd
            className={cn(
              "font-heading mt-1 text-2xl leading-none font-semibold",
              at.margin < 0 ? "text-destructive" : "text-foreground",
            )}
            data-numeric
          >
            {formatMoney(at.margin, currency)}
          </dd>
          <dd className="text-muted-foreground mt-1.5 text-xs">
            <span data-numeric>{formatMoney(price, currency)}</span> less{" "}
            <span data-numeric>{formatMoney(at.cost, currency)}</span> of cost
            {at.rate === null ? null : (
              <>
                {", "}
                <span data-numeric>{formatRate(at.rate)}</span> of the price
              </>
            )}
          </dd>
        </>
      )}
    </div>
  );
}
