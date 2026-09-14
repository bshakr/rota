import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { TrafficFailures } from "@/lib/api/super-admin-traffic";
import { formatCount } from "@/lib/charts";
import { failuresNote, formatShare } from "@/lib/hq-traffic";

/**
 * What went wrong, over the whole window rather than week by week: five codes
 * is a diagnosis, five codes times thirteen weeks is a spreadsheet.
 *
 * The shares are of EVERY failure in the range, including the ones that carry no
 * code at all — so the five rows visibly do not add up to a hundred, and the
 * line underneath says why. A top five whose shares sum to 100% is a top five
 * that has quietly redefined its denominator.
 *
 * The codes are printed raw, in mono. They are Twilio's, an operator looks them
 * up, and a friendly translation maintained on this side would be one more thing
 * to be wrong about.
 */
export function FailuresCard({ failures }: { failures: TrafficFailures }) {
  const shown = failures.top.reduce((sum, row) => sum + row.count, 0);

  return (
    <Card>
      <CardHeader>
        <CardTitle>What failed</CardTitle>
        <CardDescription>
          The five error codes behind the most failed texts in this window, worst first.
        </CardDescription>
      </CardHeader>

      <CardContent>
        {failures.top.length === 0 ? (
          // Nothing failed at all needs no sentence here: the note below already
          // says so, and two ways of saying "none" is how a card starts to look
          // like it is apologising.
          failures.total === 0 ? null : (
            <p className="text-muted-foreground text-sm">
              Every failure in this window arrived without an error code.
            </p>
          )
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Code</TableHead>
                <TableHead className="text-right">Texts</TableHead>
                <TableHead className="text-right">Share</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {failures.top.map((row) => (
                <TableRow key={row.error_code}>
                  <TableCell className="font-mono text-xs">{row.error_code}</TableCell>
                  <TableCell className="text-right" data-numeric>
                    {formatCount(row.count)}
                  </TableCell>
                  <TableCell className="text-muted-foreground text-right" data-numeric>
                    {formatShare(row.share)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}

        <p className="text-muted-foreground mt-4 text-xs text-pretty">
          {failuresNote(failures.total, failures.uncoded, shown)}
        </p>
      </CardContent>
    </Card>
  );
}
