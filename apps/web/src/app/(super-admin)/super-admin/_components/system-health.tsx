import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { SystemHealth as SystemHealthPayload } from "@/lib/api/super-admin-overview";
import { formatTimestamp, relativeTime } from "@/lib/date";
import { JOB_CADENCE_LABELS, JOB_LABELS, isJobStale, queueFailuresNote } from "@/lib/hq-overview";
import { cn } from "@/lib/utils";

/**
 * When each recurring job last finished, and how backed up the queue is.
 *
 * Read from `job_runs` rather than from Solid Queue, because Solid Queue deletes
 * its own evidence every hour — so "the sweep stopped running some time
 * yesterday" is precisely the case its tables can no longer answer.
 *
 * A row appears for every monitored job whether or not there is a run behind it.
 * "Never finished" is the loudest thing this tile can say about something
 * scheduled hourly, and it would be invisible if the list were built from the
 * rows that happen to exist.
 *
 * Staleness is measured against the job's OWN cadence from config/recurring.yml
 * (see JOB_CADENCE_MS): a daily job twenty hours quiet is fine, an hourly one is
 * not. The marker is semantic — the lemon "warning" sticker for a missed slot,
 * the blush "went wrong" one for a run that raised — never the accent, which is
 * a hover tint and would just make a healthy row look pressed.
 */
export function SystemHealth({ health, now }: { health: SystemHealthPayload; now: Date }) {
  const failed = health.queue_failed_executions;
  const queueIsBad = failed === null || failed > 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle>System health</CardTitle>
        <CardDescription>
          The jobs that keep every house texting, and whether they are still
          running.
        </CardDescription>
      </CardHeader>

      <CardContent>
        <ul className="divide-border divide-y">
          {health.jobs.map((job) => {
            const lastFinishedAt = job.last_finished_at ? new Date(job.last_finished_at) : null;
            const stale = isJobStale(lastFinishedAt, job.name, now);

            return (
              <li key={job.name} className="flex items-start justify-between gap-3 py-3 first:pt-0">
                <span className="min-w-0">
                  <span className="block text-sm font-medium">{JOB_LABELS[job.name]}</span>
                  {/* The relative time is the one worth reading at a glance, but
                      "2 days ago" is not something you can put in a bug report or
                      line up against a deploy. The exact instant rides along as
                      the hover title rather than as a second line of type. */}
                  <span
                    className="text-muted-foreground mt-0.5 block text-xs"
                    title={lastFinishedAt ? formatTimestamp(lastFinishedAt) : undefined}
                  >
                    {lastFinishedAt
                      ? `Finished ${relativeTime(lastFinishedAt, now)}`
                      : "Has never finished a pass"}{" "}
                    &middot; {JOB_CADENCE_LABELS[job.name]}
                  </span>
                  {/* The exception is the actionable half of a failed run: "it
                      raised" and "it raised Faraday::TimeoutError" are different
                      amounts of help. */}
                  {job.succeeded === false && job.error_class ? (
                    <span className="text-muted-foreground mt-0.5 block font-mono text-xs break-all">
                      {job.error_class}
                    </span>
                  ) : null}
                </span>

                <span className="flex shrink-0 flex-col items-end gap-1">
                  {job.succeeded === false ? (
                    <Badge variant="destructive">Last run failed</Badge>
                  ) : null}
                  {stale ? <Badge variant="warning">Stale</Badge> : null}
                  {!stale && job.succeeded !== false ? (
                    <Badge variant="success">Healthy</Badge>
                  ) : null}
                </span>
              </li>
            );
          })}
        </ul>

        {/* Null is "we could not ask": Solid Queue keeps its tables in a separate
            database and the API reports null rather than failing the whole
            payload when that read falls over. Rendering it as 0 would turn an
            outage into an all-clear, so it wears the same ink as a real failure. */}
        <p
          className={cn(
            "border-border mt-4 border-t pt-3 text-xs",
            queueIsBad ? "text-destructive font-medium" : "text-muted-foreground",
          )}
        >
          {queueFailuresNote(failed)}
        </p>
      </CardContent>
    </Card>
  );
}
