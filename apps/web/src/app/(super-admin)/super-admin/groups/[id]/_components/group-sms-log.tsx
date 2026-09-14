import { Suspense } from "react";
import Link from "next/link";

import { SmsFilters } from "@/components/sms-filters";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { RedactedSms } from "@/lib/api/super-admin-groups";
import type { MemberRef } from "@/lib/api/types";
import { formatShiftDate, formatTimestamp } from "@/lib/date";
import { civilDate } from "@/lib/group-dates";
import {
  GROUP_SECTION,
  NO_SMS_BODY,
  SMS_LOG_SCROLL_NOTE,
  SMS_REDACTION_NOTE,
  type SmsLogFilters,
  groupHref,
  groupLogHref,
  hasSmsLogFilters,
  nextSmsLogLimit,
  smsLogCountNote,
} from "@/lib/hq-group-report";
import { explainError, kindDisplay, reminderTiming, statusDisplay } from "@/lib/sms-display";
import { cn } from "@/lib/utils";

import { Empty } from "./group-admins";

/**
 * This house's delivery log, as the operator reads it.
 *
 * THE SAME ROWS, FOUND THE SAME WAY. `SmsMessageFiltering` serves both this
 * endpoint and the house's own /sms, and `SmsFilters` is literally the same
 * component the house's log uses — one `basePath` apart — so an operator chasing
 * "Alice didn't get her text" narrows to exactly the rows the admin who reported
 * it can see. A second filter bar that had gained or lost a status would be how
 * the two screens start disagreeing about a house.
 *
 * WHAT A ROW SAYS IS NOT THE SAME, and structurally so. Every text this product
 * sends carries the recipient's magic link, which is a permanent login to the
 * house; `SuperAdmin::SmsMessageSerializer` replaces it before the body is
 * rendered, in a different class from the house's own with no flag that could
 * turn one into the other. Nothing on this page has to remember to redact
 * anything — but the card says out loud that bodies are struck out, because an
 * operator reading "Manage: [link]" should know it is redaction and not a
 * template bug.
 *
 * ONE TABLE THAT SCROLLS IN ITS OWN BOX, rather than the house log's table-plus-
 * card-stack. This is a card on a dashboard among eight others, and a second
 * presentation of the same rows is a second thing to keep in step; the horizontal
 * scroller keeps the page itself from ever overflowing at 390px, which is the
 * rule the whole screen is held to.
 *
 * There is no cursor in this API, so "older" is a bigger `limit`, exactly as on
 * the house's own log — and the button disappears at the 500 the server caps at
 * rather than asking for 600 and silently getting 500.
 */
export function GroupSmsLog({
  groupId,
  messages,
  filters,
  members,
  rotas,
}: {
  groupId: number;
  messages: RedactedSms[];
  filters: SmsLogFilters;
  /** For the two identity filters. Primitives, not the payload — `SmsFilters` is a Client Component. */
  members: MemberRef[];
  rotas: MemberRef[];
}) {
  const narrowed = hasSmsLogFilters(filters);
  const nextLimit = nextSmsLogLimit(filters.limit);
  // Only offer "older" when this page actually filled: a short page is the whole
  // (filtered) history and a button under it would promise rows that do not exist.
  const canLoadMore = nextLimit !== null && messages.length >= filters.limit;

  return (
    <Card id={GROUP_SECTION.smsLog} className="scroll-mt-24">
      <CardHeader>
        <CardTitle>Delivery log</CardTitle>
        <CardDescription>
          Every text this house has sent, newest first, with the carrier&rsquo;s status.{" "}
          {SMS_REDACTION_NOTE}
        </CardDescription>
      </CardHeader>

      <CardContent>
        {/* `useSearchParams` suspends on a first render, exactly as on the house's
            own log, so the bar gets the same boundary and the same reserved height. */}
        <Suspense fallback={<div className="mb-6 h-8" />}>
          <SmsFilters members={members} rotas={rotas} basePath={groupHref(groupId)} />
        </Suspense>

        {messages.length === 0 ? (
          <Empty>
            {narrowed
              ? "No texts match these filters. Widen them, or clear them to see the whole log."
              : "This house has never sent a text."}
          </Empty>
        ) : (
          <>
            {/* The one place on this page allowed to scroll sideways, and it is
                this box rather than the document: a log has five columns and a
                phone has 390px. Only a phone is told so — at any width where the
                table fits, the sentence would be a false instruction. */}
            <p className="text-muted-foreground mb-2 text-xs text-pretty md:hidden">
              {SMS_LOG_SCROLL_NOTE}
            </p>
            <div className="-mx-1 overflow-x-auto px-1">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>When</TableHead>
                    <TableHead>To</TableHead>
                    <TableHead>Rota &amp; turn</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead className="text-right">Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {messages.map((message) => (
                    <MessageRows key={message.id} message={message} />
                  ))}
                </TableBody>
              </Table>
            </div>

            <div className="mt-5 flex flex-col items-center gap-2">
              {canLoadMore ? (
                <Button asChild variant="outline" size="sm">
                  <Link href={groupLogHref(groupId, { ...filters, limit: nextLimit })} scroll={false}>
                    Load older texts
                  </Link>
                </Button>
              ) : null}
              <p className="text-muted-foreground text-center text-xs">
                {smsLogCountNote(messages.length, filters.limit)}
              </p>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

// A failed row wears the BLUSH wash — the "went wrong" sticker at low strength —
// across both of its rows, exactly as the house's own log does, so the two screens
// mark a failure the same way.
const FAILED_ROW = "bg-blush/25 hover:bg-blush/40";

/**
 * One text, as two rows: the scannable summary, and the detail underneath — the
 * body that went out (redacted), the carrier's error in plain words, and the send
 * metadata.
 *
 * The body is shown ALWAYS and not only on a failure. "The template had a stray
 * placeholder" and "the text was truncated to nothing" are delivered successfully
 * and are exactly the bugs this log is opened to find.
 */
function MessageRows({ message }: { message: RedactedSms }) {
  const failed = message.status === "failed";
  const status = statusDisplay(message.status);
  const timing = message.kind === "reminder" ? reminderTiming(message.days_before) : null;
  const error = failed ? explainError(message.error_code) : null;
  const tint = failed ? FAILED_ROW : undefined;

  return (
    <>
      <TableRow className={cn("border-b-0", tint)}>
        <TableCell className="font-medium whitespace-nowrap">
          <time dateTime={message.created_at}>
            {formatTimestamp(new Date(message.created_at))}
          </time>
        </TableCell>
        <TableCell>
          <div className="flex flex-col">
            <span>{message.member.name}</span>
            {/* The number in full: a wrong country code is what "why didn't Alice
                get her text" usually turns out to be. */}
            <span className="text-muted-foreground font-mono text-xs">
              {message.member.phone_e164}
            </span>
          </div>
        </TableCell>
        <TableCell>
          <div className="flex flex-col">
            <span className="font-medium">{message.shift?.rota_name ?? "Personal link"}</span>
            <span className="text-muted-foreground text-xs">
              {message.shift ? formatShiftDate(civilDate(message.shift.due_on)) : "House entry"}
            </span>
          </div>
        </TableCell>
        <TableCell>
          <div className="flex flex-col gap-0.5">
            <Badge variant="secondary" className="w-fit">
              {kindDisplay(message.kind)}
            </Badge>
            {timing ? <span className="text-muted-foreground text-xs">{timing}</span> : null}
          </div>
        </TableCell>
        <TableCell className="text-right align-top">
          <Badge variant={status.tone}>{status.label}</Badge>
        </TableCell>
      </TableRow>

      <TableRow className={cn("border-b", tint)}>
        <TableCell colSpan={5} className="pt-0 whitespace-normal">
          <div className="space-y-2">
            {/* The failure in plain words, as a line rather than the house log's
                full `Alert`: this table sits inside a card among eight others, and
                a stacked alert per failed row would out-shout the page's own
                warnings section. The sentence, the blush wash and the Failed
                sticker are the same three signals, at a dashboard's volume. */}
            {error ? (
              <p className="text-sm text-pretty">
                <span className="font-medium">{error.summary}</span>
                {error.detail ? (
                  <span className="text-muted-foreground"> {error.detail}</span>
                ) : null}
              </p>
            ) : null}
            <p className="bg-muted text-foreground max-w-prose rounded-2xl rounded-bl-sm px-3.5 py-2.5 font-mono text-xs break-words whitespace-pre-wrap">
              {message.body ?? NO_SMS_BODY}
            </p>
            <p className="text-muted-foreground font-mono text-xs break-words">
              {sendMeta(message)}
            </p>
          </div>
        </TableCell>
      </TableRow>
    </>
  );
}

function sendMeta(message: RedactedSms): string {
  const parts = [`Queued ${formatTimestamp(new Date(message.created_at))}`];
  if (message.sent_at) parts.push(`Sent ${formatTimestamp(new Date(message.sent_at))}`);
  if (message.twilio_sid) parts.push(`Twilio ${message.twilio_sid}`);
  return parts.join(" · ");
}
