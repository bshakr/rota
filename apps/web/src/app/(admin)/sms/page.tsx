import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { Inbox, TriangleAlert } from "lucide-react";

import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { listMembers, listRotas, listSmsMessages } from "@/lib/api/admin";
import { formatShiftDate, formatTimestamp } from "@/lib/date";
import type { SmsKind, SmsMessage, SmsStatus } from "@/lib/api/types";
import { cn } from "@/lib/utils";

import { SmsFilters } from "./_components/sms-filters";
import { explainError, kindDisplay, reminderTiming, statusDisplay } from "./_lib/display";

export const metadata: Metadata = { title: "SMS log" };

// The API defaults to 100 and hard-caps at 500 (see SmsMessagesController). We
// grow the page by whole hundreds; when the cap is reached there is nothing more
// to load.
const PAGE = 100;
const MAX_LIMIT = 500;

const KNOWN_STATUSES = new Set<SmsStatus>([
  "pending",
  "sending",
  "sent",
  "delivered",
  "failed",
]);
const KNOWN_KINDS = new Set<SmsKind>(["reminder", "cover_notice"]);

type RawParams = Record<string, string | string[] | undefined>;

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function toId(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : undefined;
}

// A day string (YYYY-MM-DD) is UTC midnight when parsed; formatShiftDate pins the
// zone, and London is never behind UTC, so the civil day never rolls back.
function shiftDay(dueOn: string): string {
  return formatShiftDate(new Date(dueOn));
}

export default async function SmsLogPage({
  searchParams,
}: {
  searchParams: Promise<RawParams>;
}) {
  const sp = await searchParams;

  const statusParam = first(sp.status);
  const kindParam = first(sp.kind);
  const status =
    statusParam && KNOWN_STATUSES.has(statusParam) ? statusParam : undefined;
  const kind =
    kindParam && KNOWN_KINDS.has(kindParam as SmsKind) ? (kindParam as SmsKind) : undefined;
  const memberId = toId(first(sp.member_id));
  const rotaId = toId(first(sp.rota_id));

  const requestedLimit = Number(first(sp.limit));
  const limit =
    Number.isFinite(requestedLimit) && requestedLimit > 0
      ? Math.min(requestedLimit, MAX_LIMIT)
      : PAGE;

  const hasFilters = Boolean(status || kind || memberId || rotaId);

  const [{ sms_messages: messages }, { members }, { rotas }] = await Promise.all([
    listSmsMessages({ status, kind, member_id: memberId, rota_id: rotaId, limit }),
    listMembers(),
    listRotas(),
  ]);

  // The API returns at most `limit` rows, newest first. If it filled the page
  // there is very likely more, up to the 500 cap; if it came back short we have
  // the whole (filtered) history.
  const atCap = limit >= MAX_LIMIT;
  const canLoadMore = messages.length >= limit && !atCap;
  const loadMoreHref = buildHref({ status, kind, memberId, rotaId }, Math.min(limit + PAGE, MAX_LIMIT));

  return (
    <>
      <PageHeader
        title="SMS log"
        description="Every message the house has sent, newest first, with the carrier’s delivery status. The screen that answers “why didn’t Alice get her text”."
      />

      <Suspense fallback={<div className="mb-6 h-8" />}>
        <SmsFilters members={members} rotas={rotas} />
      </Suspense>

      {messages.length === 0 ? (
        hasFilters ? (
          <EmptyState
            icon={Inbox}
            title="No messages match these filters"
            description="Nothing here for this combination. Widen the status, member or rota — or clear the filters to see the whole log."
            action={
              <Button asChild variant="outline" size="sm">
                <Link href="/sms">Clear filters</Link>
              </Button>
            }
          />
        ) : (
          <EmptyState
            icon={Inbox}
            title="No messages yet"
            description="When a reminder or a cover notice goes out, every attempt shows up here with its carrier delivery status."
          />
        )
      ) : (
        <>
          {/* md and up: the table. shadow-xs to match the Card idiom. */}
          <div className="border-border bg-card hidden overflow-hidden rounded-xl border shadow-xs md:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>When</TableHead>
                  <TableHead>To</TableHead>
                  <TableHead>Rota &amp; shift</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead className="text-right">Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {messages.map((m) => (
                  <MessageRows key={m.id} message={m} />
                ))}
              </TableBody>
            </Table>
          </div>

          {/* below md: the card stack, from the same data. */}
          <div className="flex flex-col gap-3 md:hidden">
            {messages.map((m) => (
              <MessageCard key={m.id} message={m} />
            ))}
          </div>

          <div className="mt-6 flex flex-col items-center gap-2">
            {canLoadMore ? (
              <Button asChild variant="outline">
                <Link href={loadMoreHref} scroll={false}>
                  Load older messages
                </Link>
              </Button>
            ) : null}
            <p className="text-muted-foreground text-center text-xs">
              {atCap && messages.length >= MAX_LIMIT
                ? `Showing the most recent ${MAX_LIMIT} messages.`
                : `Showing ${messages.length} ${messages.length === 1 ? "message" : "messages"}.`}
            </p>
          </div>
        </>
      )}
    </>
  );
}

// Everything the table and the card need to read off a message, derived once so
// the two presentations cannot drift. `error` is resolved only for a failed row.
function viewFor(m: SmsMessage) {
  const failed = m.status === "failed";
  return {
    status: statusDisplay(m.status),
    failed,
    timing: m.kind === "reminder" ? reminderTiming(m.days_before) : null,
    error: failed ? explainError(m.error_code) : null,
  };
}

// A message renders as two rows: the scannable summary, and a detail row that
// always shows the exact body that was sent (magic link included) plus the send
// metadata. A failed message is loud — the whole group is tinted, carries a left
// accent, and its detail row leads with a bordered Alert explaining the failure
// in plain words, not a bare code.
function MessageRows({ message: m }: { message: SmsMessage }) {
  const { status: s, failed, timing, error } = viewFor(m);

  const tint = failed ? "bg-destructive/5 hover:bg-destructive/10" : undefined;
  const accent = failed ? "border-l-2 border-l-destructive" : undefined;

  return (
    <>
      <TableRow className={cn("border-b-0", tint)}>
        <TableCell className={cn("font-medium", accent)}>
          {formatTimestamp(new Date(m.created_at))}
        </TableCell>
        <TableCell>{m.member.name}</TableCell>
        <TableCell>
          <div className="flex flex-col">
            <span className="font-medium">{m.shift.rota_name}</span>
            <span className="text-muted-foreground text-xs">{shiftDay(m.shift.due_on)}</span>
          </div>
        </TableCell>
        <TableCell>
          {/* Plain text, not a badge: kind is metadata, and the status idiom
              reserves badges for status. A pill in every row of a 100-row log
              is a hundred pills saying nothing. */}
          <div className="flex flex-col gap-0.5">
            <span>{kindDisplay(m.kind)}</span>
            {timing ? <span className="text-muted-foreground text-xs">{timing}</span> : null}
          </div>
        </TableCell>
        <TableCell className="text-right align-top">
          <Badge variant={s.tone}>{s.label}</Badge>
        </TableCell>
      </TableRow>
      <TableRow className={cn("border-b", tint)}>
        <TableCell colSpan={5} className={cn("whitespace-normal pt-0", accent)}>
          <div className="space-y-2">
            {error ? (
              <Alert variant="destructive">
                <TriangleAlert />
                <AlertTitle>{error.summary}</AlertTitle>
                {error.detail ? <AlertDescription>{error.detail}</AlertDescription> : null}
              </Alert>
            ) : null}
            <MessageBody body={m.body} />
            <SendMeta message={m} />
          </div>
        </TableCell>
      </TableRow>
    </>
  );
}

function MessageCard({ message: m }: { message: SmsMessage }) {
  const { status: s, failed, timing, error } = viewFor(m);

  return (
    <Card size="sm" className={failed ? "border-destructive/40 bg-destructive/5" : undefined}>
      <CardHeader>
        <CardTitle className="text-sm">{m.shift.rota_name}</CardTitle>
        <CardDescription>{shiftDay(m.shift.due_on)}</CardDescription>
        <CardAction>
          <Badge variant={s.tone}>{s.label}</Badge>
        </CardAction>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <div className="flex flex-col gap-0.5">
          <span>
            To <span className="font-medium">{m.member.name}</span>
          </span>
          <span className="text-muted-foreground text-xs">
            {kindDisplay(m.kind)}
            {timing ? ` · ${timing}` : ""} · {formatTimestamp(new Date(m.created_at))}
          </span>
        </div>
        {error ? (
          <Alert variant="destructive">
            <TriangleAlert />
            <AlertTitle>{error.summary}</AlertTitle>
            {error.detail ? <AlertDescription>{error.detail}</AlertDescription> : null}
          </Alert>
        ) : null}
        <MessageBody body={m.body} />
      </CardContent>
    </Card>
  );
}

function MessageBody({ body }: { body: string }) {
  return (
    <div>
      <p className="text-muted-foreground mb-1 text-xs font-medium">Message</p>
      <p className="bg-muted/40 text-foreground rounded-md px-3 py-2 font-mono text-xs break-words whitespace-pre-wrap">
        {body}
      </p>
    </div>
  );
}

function SendMeta({ message: m }: { message: SmsMessage }) {
  const parts = [`Queued ${formatTimestamp(new Date(m.created_at))}`];
  if (m.sent_at) parts.push(`Sent ${formatTimestamp(new Date(m.sent_at))}`);
  if (m.twilio_sid) parts.push(`Twilio ${m.twilio_sid}`);
  return <p className="text-muted-foreground font-mono text-xs">{parts.join(" · ")}</p>;
}

function buildHref(
  filters: { status?: string; kind?: string; memberId?: number; rotaId?: number },
  limit: number,
): string {
  const params = new URLSearchParams();
  if (filters.status) params.set("status", filters.status);
  if (filters.kind) params.set("kind", filters.kind);
  if (filters.memberId) params.set("member_id", String(filters.memberId));
  if (filters.rotaId) params.set("rota_id", String(filters.rotaId));
  params.set("limit", String(limit));
  return `/sms?${params.toString()}`;
}
