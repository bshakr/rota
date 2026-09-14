import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { SuperAdminSpend } from "@/lib/api/super-admin-spend";
import { formatCount } from "@/lib/charts";
import { plural } from "@/lib/hq-overview";
import { unitFigure } from "@/lib/hq-spend";

/**
 * The numbers a price gets set against: what a house costs per month at the
 * middle and at the ninetieth percentile, the same per housemate, and the two
 * per-unit prices.
 *
 * NEAREST RANK, both percentiles, which Rails computes — so every figure quoted
 * is a house that actually exists rather than an interpolation between two. That
 * matters because the next question an operator asks is always "which house is
 * that?".
 *
 * THE SAMPLE SIZE TRAVELS WITH THE FIGURE. A median of four houses and a median
 * of four hundred are different facts, and the per-member spread has a smaller
 * n than the per-house one by construction: a house with nobody left to text
 * cannot be divided and is dropped from that spread entirely rather than counted
 * as free.
 *
 * Every one of these can legitimately have no answer, and each says "not enough
 * data" rather than "£0.00". On a page where the output is a price, a zero that
 * means "we could not measure" is the most expensive thing on screen.
 */
export function UnitEconomics({ spend }: { spend: SuperAdminSpend }) {
  const unit = spend.unit_economics;
  const houses = unit.houses_measured;
  const housed = unit.houses_with_active_members;

  const figures = [
    {
      label: "Median house, per month",
      value: unit.cost_per_house_per_month.median,
      note: `across ${formatCount(houses)} ${plural(houses, "house", "houses")} that spent anything`,
    },
    {
      label: "p90 house, per month",
      value: unit.cost_per_house_per_month.p90,
      // The sample size rides with the p90 exactly as it does with the median
      // beside it. A ninetieth percentile of four houses is one house, and a
      // reader who cannot see that from the tile will quote it as a spread.
      note: `p90 of ${formatCount(houses)} ${plural(houses, "house", "houses")}: the dearest tenth starts here`,
    },
    {
      label: "Median housemate, per month",
      value: unit.cost_per_active_member_per_month.median,
      note: `across ${formatCount(housed)} ${plural(housed, "house", "houses")} with anybody on the roll`,
    },
    {
      label: "p90 housemate, per month",
      value: unit.cost_per_active_member_per_month.p90,
      note: `p90 of ${formatCount(housed)} ${plural(housed, "house", "houses")}; houses with nobody left to text are not in this spread`,
    },
    {
      label: "Per text sent",
      value: unit.cost_per_text_sent,
      note: `${formatCount(spend.totals.texts_sent)} ${plural(spend.totals.texts_sent, "text", "texts")} Twilio accepted, settled and estimated together`,
    },
    {
      label: "Per title classified",
      value: unit.cost_per_title_classified,
      note: `${formatCount(spend.totals.titles_classified)} ${plural(spend.totals.titles_classified, "title", "titles")} from calls that succeeded`,
    },
  ];

  return (
    <Card>
      <CardHeader>
        <CardTitle>Unit economics</CardTitle>
        <CardDescription>
          Every figure divides by the window&rsquo;s true length, {spend.months_in_range} months, so
          a month means the same thing in all three windows.
        </CardDescription>
      </CardHeader>

      <CardContent>
        <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {figures.map((figure) => (
            <div key={figure.label} className="bg-muted/60 rounded-xl px-4 py-3.5">
              <dt className="text-muted-foreground text-xs">{figure.label}</dt>
              {/* "Not enough data" is words, not a figure, so it is set as
                  words: a sentence in the 20px display numeral wraps to three
                  shouted lines and reads as the loudest thing on the card, which
                  is the opposite of what "we could not measure this" should look
                  like. Never "£0.00" either — on a pricing page that is the most
                  expensive lie on screen. */}
              {figure.value === null ? (
                <dd className="text-muted-foreground mt-1 text-sm">{unitFigure(null, spend.currency)}</dd>
              ) : (
                <dd
                  className="font-heading text-foreground mt-1 text-xl leading-none font-semibold"
                  data-numeric
                >
                  {unitFigure(figure.value, spend.currency)}
                </dd>
              )}
              <dd className="text-muted-foreground mt-1.5 text-xs text-pretty">{figure.note}</dd>
            </div>
          ))}
        </dl>

        <p className="text-muted-foreground mt-4 text-xs text-pretty">
          Claude is cached per title fingerprint, so a house&rsquo;s cost is front-loaded: the first
          sync pays for every title on the calendar and a steady month pays only for new ones. A
          house re-paying for its whole calendar shows up in the table below as calls, not as a
          quietly larger total.
        </p>
      </CardContent>
    </Card>
  );
}
