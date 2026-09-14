import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { TrafficVisits } from "@/lib/api/super-admin-traffic";
import { formatCount } from "@/lib/charts";
import {
  BROWSER_LABELS,
  DEVICE_LABELS,
  OS_LABELS,
  VISIT_COLUMNS,
  visitsCoverageNote,
} from "@/lib/hq-traffic";

/**
 * Where the funnel's first step came from: which site linked here, which country
 * and city, and what the visitor was holding.
 *
 * Six small tables rather than six charts. Each one is a short ranked list of
 * counts, which is a table; drawing bars for ten referrers would spend the
 * page's one chart grammar on the least interesting numbers on it. The table
 * markup is the failures card's, deliberately, so the ranked lists on this page
 * read the same way.
 *
 * TWO ROWS OF THREE, which is the layout and also the argument. The first three
 * columns answer "where did this visit come from" and the last three answer "what
 * did it arrive on", and the order they are declared in is what puts each trio on
 * its own line at md and up. Six columns in one row would be six cramped tables
 * and no grouping at all; below md they stack into one column, as they did when
 * there were three.
 *
 * COUNTS ONLY, no shares. A share needs a denominator, and every column here has
 * a different one: the visits that carried a referrer, the visits that carried a
 * city, the visits that carried a browser family. Printing six percentages of six
 * different totals side by side is how a panel starts being read as one breakdown
 * that does not add up. The one share worth having is under the whole panel,
 * where it can name its denominator in words.
 *
 * THE EMPTY STATES ARE NOT INTERCHANGEABLE, which is the reason the words live
 * in hq-traffic.ts rather than here. An empty city column is not "nobody visited
 * from anywhere" — it is the state this deploy is in every single day until the
 * Cloudflare zone's visitor location headers are switched on. Rendering the same
 * "no data" line in all six would turn a configuration fact into an apparent
 * absence of traffic, directly contradicting the bar above it.
 */
export function VisitsPanel({ visits, views }: { visits: TrafficVisits; views: number }) {
  const columns = [
    {
      dimension: "referrers" as const,
      unit: "Site",
      rows: visits.referrers.map((row) => ({ label: row.host, count: row.count })),
    },
    {
      dimension: "countries" as const,
      unit: "Code",
      rows: visits.countries.map((row) => ({ label: row.code, count: row.count })),
    },
    {
      dimension: "cities" as const,
      unit: "Place",
      rows: visits.cities.map((row) => ({ label: row.city, count: row.count })),
    },
    {
      dimension: "devices" as const,
      unit: "Kind",
      rows: visits.devices.map((row) => ({
        label: DEVICE_LABELS[row.device],
        count: row.count,
      })),
    },
    {
      dimension: "browsers" as const,
      unit: "Name",
      rows: visits.browsers.map((row) => ({
        label: BROWSER_LABELS[row.browser],
        count: row.count,
      })),
    },
    {
      dimension: "operating_systems" as const,
      unit: "Name",
      rows: visits.operating_systems.map((row) => ({
        label: OS_LABELS[row.os],
        count: row.count,
      })),
    },
  ];

  // Rails' ungrouped count, NOT the sum of the rows above. The list stops at ten
  // hosts, so summing it would answer "how many arrived from the ten commonest
  // sites" while appearing to answer "how many arrived from another site" — and
  // would keep appearing to, quietly, from the eleventh host onwards.
  const referred = visits.referred_count;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Where visits come from</CardTitle>
        <CardDescription>
          The visits counted in step 1, by what the page could tell about them without a cookie, an
          identifier or an address. Where they came from: the site that linked here, the country and
          the city. What they arrived on: a phone, a tablet or a computer, which browser and which
          operating system, each by name and never by version.
        </CardDescription>
      </CardHeader>

      <CardContent>
        <div className="grid items-start gap-x-6 gap-y-8 md:grid-cols-3">
          {columns.map((column) => {
            const { heading, empty } = VISIT_COLUMNS[column.dimension];

            return (
              <div key={column.dimension} className="grid gap-2">
                <h3 className="text-sm font-medium">{heading}</h3>

                {column.rows.length === 0 ? (
                  <p className="text-muted-foreground text-xs text-pretty">{empty}</p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>{column.unit}</TableHead>
                        <TableHead className="text-right">Visits</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {column.rows.map((row) => (
                        <TableRow key={row.label}>
                          <TableCell className="break-all">{row.label}</TableCell>
                          <TableCell className="text-right" data-numeric>
                            {formatCount(row.count)}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </div>
            );
          })}
        </div>

        <p className="text-muted-foreground mt-6 text-xs text-pretty">
          {visitsCoverageNote(referred, views)} Nothing here is stored against a visitor: there is
          no cookie, no identifier and no address in a row, so two visits from one person cannot be
          told apart from two visits from two.
        </p>
      </CardContent>
    </Card>
  );
}
