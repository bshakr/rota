"use client";

import * as React from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { OctagonAlert, TriangleAlert } from "lucide-react";
import { z } from "zod";

import { Alert, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { toastApiError } from "@/lib/api/toast";
import type { CalendarEventPreviewItem, CalendarSummary } from "@/lib/api/types";
import { formatShiftDate, relativeTime } from "@/lib/date";
import { civilDate } from "@/lib/group-dates";

import { connectHouseCalendar, disconnectHouseCalendar, syncHouseCalendar } from "../actions";

// One message covers every way the field can be wrong, which is what the spec asks
// for: "Not https://, or not a URL at all: Paste the full https link." `z.url` with
// a protocol pattern rejects both, and the `trim()` in front means a link pasted
// with a trailing space is accepted rather than scolded.
const schema = z.object({
  ical_url: z
    .string()
    .trim()
    .pipe(z.url({ protocol: /^https$/, error: "Paste the full https link." })),
});
type Values = z.infer<typeof schema>;

// The same pairing the dashboard's warning list uses, so a failing calendar wears
// the stop sign here and one card up rather than two different faces.
const ALERT_ICON = { warning: TriangleAlert, destructive: OctagonAlert } as const;

/**
 * The house calendar link (BLO-1667). Lives inside the group-settings card because the dashboard's
 * "House calendar isn't syncing" warning links here (anchor `#house-calendar`). The pasted link is
 * sent once and never shown again: the API answers with a masked form, a calendar name and a count,
 * which is all an admin needs to recognise it.
 */
export function HouseCalendarSettings({
  calendar,
  initialEvents,
  memberNames,
  now,
}: {
  calendar: CalendarSummary | null;
  initialEvents: CalendarEventPreviewItem[];
  /** Member id → name, for naming the housemates an away event was matched to. */
  memberNames: Record<number, string>;
  /** The instant the server rendered at, ISO. Explicit so "last checked" is the same string in both runtimes. */
  now: string;
}) {
  const [connection, setConnection] = React.useState(calendar);
  const [events, setEvents] = React.useState(initialEvents);
  const [busy, setBusy] = React.useState<"sync" | "disconnect" | null>(null);
  const form = useForm<Values>({ resolver: zodResolver(schema), defaultValues: { ical_url: "" } });
  const { errors, isSubmitting } = form.formState;

  // Every calendar action revalidates /dashboard, and so does saving the group
  // settings form directly above, so a fresh summary and preview arrive as new
  // props while this component keeps its state. Take both together: adopting only
  // the events would let the list below show an hourly sweep's new entries while
  // the counts, "last checked" and the failing alert above stayed frozen at
  // whatever the last button press returned. This is React's documented way to
  // reset state when a prop changes, and it costs no effect and no extra render.
  const [fromServer, setFromServer] = React.useState({ calendar, initialEvents });
  if (fromServer.calendar !== calendar || fromServer.initialEvents !== initialEvents) {
    setFromServer({ calendar, initialEvents });
    setConnection(calendar);
    setEvents(initialEvents);
  }

  const onConnect = form.handleSubmit(async (values) => {
    const result = await connectHouseCalendar(values.ical_url);
    if (!result.ok) {
      const fieldError = result.error.fields?.ical_url?.[0];
      if (fieldError) form.setError("ical_url", { message: fieldError });
      else toastApiError(result.error, "Couldn't connect the calendar.");
      return;
    }
    setConnection(result.calendar);
    setEvents(result.events);
    // The raw link is a credential: clear it the moment Rails has it, so the only
    // form of it on this screen from here on is the masked one.
    form.reset({ ical_url: "" });
    toast.success(`Connected to ${result.calendar.calendar_name ?? "the calendar"}.`);
  });

  async function onSync() {
    setBusy("sync");
    try {
      const result = await syncHouseCalendar();
      if (!result.ok) return toastApiError(result.error, "Couldn't sync the calendar.");
      setConnection(result.calendar);
      // A sync that answers 200 can still have failed against Google; the stored
      // error is the honest thing to show, and it is not a success.
      if (result.calendar.last_error) toast.error(result.calendar.last_error);
      else toast.success("Calendar synced.");
    } catch (error) {
      // A non-ApiError failure (the API host unreachable, say) is re-thrown by the
      // action; catch it so the card stays put with a toast rather than surfacing
      // an unhandled rejection. `finally` is what guarantees the button comes back
      // out of its spinner, which is the longest wait on this surface.
      toastApiError(error, "Couldn't sync the calendar.");
    } finally {
      setBusy(null);
    }
  }

  async function onDisconnect() {
    setBusy("disconnect");
    try {
      const result = await disconnectHouseCalendar();
      if (!result.ok) return toastApiError(result.error, "Couldn't disconnect the calendar.");
      setConnection(null);
      setEvents([]);
      toast.success("Calendar disconnected.");
    } catch (error) {
      toastApiError(error, "Couldn't disconnect the calendar.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <section id="house-calendar" className="mt-8 scroll-mt-6 border-t pt-6">
      <h3 className="font-heading text-lg leading-snug font-semibold">House calendar</h3>
      <p className="text-muted-foreground mt-1 text-sm">
        Show the house&apos;s shared calendar on everyone&apos;s rota page: dinners, meetings, and
        who is away. New events appear within an hour or two.
      </p>

      {connection === null ? (
        <form onSubmit={onConnect} className="mt-4 max-w-sm">
          <FieldGroup>
            <Field data-invalid={Boolean(errors.ical_url)}>
              <FieldLabel htmlFor="ical-url">Calendar link</FieldLabel>
              <Input
                id="ical-url"
                inputMode="url"
                autoComplete="off"
                placeholder="https://calendar.google.com/calendar/ical/…/basic.ics"
                aria-invalid={Boolean(errors.ical_url)}
                {...form.register("ical_url")}
              />
              <FieldDescription>
                In Google Calendar open Settings, pick the house calendar, and copy the Secret
                address in iCal format. Anyone with this link can read the calendar, so it is stored
                like a password. Event titles are sent to Anthropic&apos;s Claude to tell trips from
                other events.
              </FieldDescription>
              <FieldError errors={[errors.ical_url]} />
            </Field>
            {/* Rails fetches, parses and classifies the whole calendar in this one
                request, which is five to fifteen seconds of waiting, so the label
                says what is happening rather than leaving a silent spinner. */}
            <Button type="submit" size="lg" loading={isSubmitting} className="w-full sm:w-auto">
              {isSubmitting ? "Connecting" : "Connect"}
            </Button>
          </FieldGroup>
        </form>
      ) : (
        <div className="mt-4 flex flex-col gap-4">
          <p className="text-sm">
            Connected to <strong>{connection.calendar_name ?? "the calendar"}</strong> ·{" "}
            {connection.events_count} {connection.events_count === 1 ? "event" : "events"} in the
            next 90 days · last checked{" "}
            {connection.last_synced_at
              ? relativeTime(new Date(connection.last_synced_at), new Date(now))
              : "never"}
            <span className="text-muted-foreground block break-all">{connection.masked_url}</span>
          </p>

          {connection.last_error ? (
            <CalendarError message={connection.last_error} failing={connection.failing} />
          ) : null}

          {connection.unclassified_count > 0 ? (
            <p role="status" className="text-muted-foreground text-sm">
              {/* The tail of the sentence is a JS string rather than JSX text. Written
                  as text it wrapped onto a second line carrying `&apos;`, and the
                  transform then dropped the space in front of "not", so the card read
                  "2 eventsnot sorted yet." A string has no whitespace rules to lose. */}
              {connection.unclassified_count}{" "}
              {connection.unclassified_count === 1 ? "event" : "events"}
              {" not sorted yet. We’ll try again within the hour."}
            </p>
          ) : null}

          {/* Both buttons go inert while either is in flight. Without that, a
              disconnect and a sync can overlap: the disconnect resolves first and
              clears the card, then the sync's reply puts a calendar the server has
              already deleted back on screen with every control pointing at a 404. */}
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="secondary"
              onClick={onSync}
              loading={busy === "sync"}
              disabled={busy !== null}
            >
              Sync now
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={onDisconnect}
              loading={busy === "disconnect"}
              disabled={busy !== null}
            >
              Disconnect
            </Button>
          </div>

          {/* The disclosure exists so a misclassified title can be SPOTTED: the
              fix is renaming the event in Google Calendar, which is why every row
              leads with the title and carries the model's reason underneath. */}
          <details className="text-sm">
            <summary className="cursor-pointer font-semibold">What we found (next 30 days)</summary>
            {events.length === 0 ? (
              <p className="text-muted-foreground mt-2">Nothing in the next 30 days.</p>
            ) : (
              <ul className="mt-2 flex flex-col gap-3">
                {events.map((event) => (
                  <li key={event.id} className="flex flex-col gap-0.5">
                    <span className="flex flex-wrap items-center gap-2">
                      <Badge variant={event.kind === "away" ? "warning" : "info"}>
                        {event.kind === "away" ? "Away" : "Event"}
                      </Badge>
                      <span>{event.title}</span>
                    </span>
                    <span className="text-muted-foreground text-xs">
                      {eventMeta(event, memberNames)}
                    </span>
                    {event.reason ? (
                      <span className="text-muted-foreground text-xs">{event.reason}</span>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </details>
        </div>
      )}
    </section>
  );
}

/** Spec state 4: the last error in plain words, wearing the same face as the dashboard's own warning. */
function CalendarError({ message, failing }: { message: string; failing: boolean }) {
  const variant = failing ? "destructive" : "warning";
  const Icon = ALERT_ICON[variant];
  return (
    <Alert variant={variant}>
      <Icon aria-hidden />
      <AlertTitle className="text-pretty">{message}</AlertTitle>
    </Alert>
  );
}

/**
 * The one muted line under an event's title: when it runs, what time it starts, and
 * for an away event which housemates it was matched to. Dates go through
 * `formatShiftDate` (the app's list voice, "Wed 16 Sept") rather than the long form,
 * because a 30-day list at phone width cannot afford two full sentences of date per
 * row, and everything here is inside a month so the year adds nothing.
 */
function eventMeta(event: CalendarEventPreviewItem, memberNames: Record<number, string>): string {
  const parts = [
    event.ends_on === event.starts_on
      ? formatShiftDate(civilDate(event.starts_on))
      : `${formatShiftDate(civilDate(event.starts_on))} to ${formatShiftDate(civilDate(event.ends_on))}`,
  ];
  if (event.start_time) parts.push(event.start_time);
  if (event.kind === "away") {
    // A member deactivated since the verdict is no longer in the roster; name the
    // ones we can rather than rendering "undefined". The lead-in matters: a bare
    // list of names reads as who organised the thing, not who is out of the house.
    const names = event.member_ids.map((id) => memberNames[id]).filter(Boolean);
    if (names.length > 0) parts.push(`Away: ${names.join(", ")}`);
  }
  return parts.join(" · ");
}
