"use client";

import * as React from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { Controller, useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";
import {
  Inbox,
  MoreHorizontal,
  Plus,
  RotateCcw,
  TriangleAlert,
  Users,
} from "lucide-react";

import { Demo, Section } from "@/app/styleguide/_components/spec";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { EmptyState } from "@/components/empty-state";
import { InvalidLink } from "@/components/member/invalid-link";
import { ShiftCard } from "@/components/member/shift-card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { formatLongDate, formatShiftDate, formatTimestamp } from "@/lib/date";
import { initials } from "@/lib/format";

const MEMBERS = ["Alice", "Bob", "Cara", "Dave"] as const;

// Fixed dates, never `new Date()`: a styleguide that renders a different thing
// every day is a styleguide you cannot diff, and "today" evaluated on the server
// and the client can differ by a day across midnight.
const TODAY = new Date(2026, 6, 2);
const SAMPLE_DAY = new Date(2026, 6, 4);
const SAMPLE_SENT_AT = new Date(2026, 6, 1, 9, 0);

// The SMS delivery log's four outcomes, in one place so the table and the badge
// row cannot drift.
const SMS_STATUS = {
  delivered: { variant: "success", label: "Delivered" },
  queued: { variant: "info", label: "Queued" },
  sending: { variant: "warning", label: "Sending" },
  failed: { variant: "destructive", label: "Failed" },
} as const;

const SHIFTS = [
  { rota: "Kitchen deep clean", date: new Date(2026, 6, 4), who: "Bob", cover: "Alice", status: "delivered" },
  { rota: "Bins", date: new Date(2026, 6, 9), who: "Cara", cover: null, status: "queued" },
  { rota: "Bathroom", date: new Date(2026, 6, 18), who: "Dave", cover: null, status: "failed" },
] as const;

/* -------------------------------------------------------------------------- */
/* The canonical form. Copy this shape.                                        */
/* -------------------------------------------------------------------------- */

const coverSchema = z.object({
  member: z.string().min(1, "Choose who is covering."),
  note: z.string().max(140, "Keep it under 140 characters.").optional(),
});

function CoverForm() {
  const form = useForm<z.infer<typeof coverSchema>>({
    resolver: zodResolver(coverSchema),
    defaultValues: { member: "", note: "" },
  });
  const { errors } = form.formState;

  return (
    <form
      className="w-full max-w-sm"
      onSubmit={form.handleSubmit((values) =>
        toast.success(`${values.member} is covering Saturday.`, {
          description: "They have been texted their own link.",
        }),
      )}
    >
      <FieldGroup>
        {/* Controller, not form.watch(): any non-native input (Select, Calendar,
            a drag-to-reorder roster) goes through Controller — the supported
            bridge for a controlled component, and watch() in render is flagged
            unmemoizable by the React Compiler. */}
        <Field data-invalid={Boolean(errors.member)}>
          <FieldLabel htmlFor="cover-member">Who is covering?</FieldLabel>
          <Controller
            control={form.control}
            name="member"
            render={({ field }) => (
              <Select value={field.value} onValueChange={field.onChange}>
                <SelectTrigger
                  id="cover-member"
                  className="w-full"
                  onBlur={field.onBlur}
                  aria-invalid={Boolean(errors.member)}
                >
                  <SelectValue placeholder="Pick someone" />
                </SelectTrigger>
                <SelectContent>
                  {MEMBERS.filter((m) => m !== "Alice").map((m) => (
                    <SelectItem key={m} value={m}>
                      {m}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          />
          <FieldDescription>
            They get a text with their own link. No acceptance needed.
          </FieldDescription>
          <FieldError errors={[errors.member]} />
        </Field>

        <Field data-invalid={Boolean(errors.note)}>
          <FieldLabel htmlFor="cover-note">Note (optional)</FieldLabel>
          <Input id="cover-note" placeholder="Away that weekend" {...form.register("note")} />
          <FieldError errors={[errors.note]} />
        </Field>

        <Button type="submit" size="lg" className="w-full sm:w-auto">
          Ask them to cover
        </Button>
      </FieldGroup>
    </form>
  );
}

/* -------------------------------------------------------------------------- */

// The motion language, live. Remounting the row replays the entrances — the
// exact choreography the member page's shift list uses.
function MotionDemo() {
  const [run, setRun] = React.useState(0);
  return (
    <div className="flex w-full flex-col gap-4">
      <div className="grid gap-3 sm:grid-cols-3" key={run}>
        {["First in", "Second in", "Third in"].map((label, index) => (
          <Card
            key={label}
            size="sm"
            className="animate-rise"
            style={{ animationDelay: `${index * 90}ms` }}
          >
            <CardHeader>
              <CardTitle>{label}</CardTitle>
              <CardDescription>
                animate-rise · {index * 90}ms delay
              </CardDescription>
            </CardHeader>
          </Card>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="secondary" size="sm" onClick={() => setRun((n) => n + 1)}>
          <RotateCcw /> Replay entrances
        </Button>
        <span className="text-muted-foreground text-xs">
          Cards rise and settle with a spring; lists stagger by ~70–90ms per
          item. Hover any button to feel the lift; press to feel the squash.
        </span>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */

function LoadingButtonDemo() {
  const [loading, setLoading] = React.useState(false);
  return (
    <Button
      loading={loading}
      onClick={() => {
        setLoading(true);
        setTimeout(() => setLoading(false), 1600);
      }}
    >
      {loading ? "Asking Bob…" : "Ask Bob to cover"}
    </Button>
  );
}

/* -------------------------------------------------------------------------- */

export function Gallery() {
  const [date, setDate] = React.useState<Date | undefined>(SAMPLE_DAY);

  return (
    <div className="flex flex-col gap-14">
      <Section
        id="buttons"
        title="Buttons"
        intro="Pills, and tactile: the primary is an iris→raspberry gradient with a soft glow that lifts on hover and squashes on press (spring-eased, stilled under reduced-motion). Ghost and outline hovers blush lilac rather than grey. `lg` is 44px — the comfortable touch target and the member page's CTA size; `default` (40px) is the admin workhorse; `xs`/`sm` are mouse-target sizes. `loading` shows a spinner, disables, and sets aria-busy."
      >
        <div className="flex flex-col gap-4">
          <Demo label="Variants" hint="variant=">
            <Button>Add member</Button>
            <Button variant="secondary">Cancel</Button>
            <Button variant="outline">Export</Button>
            <Button variant="ghost">Dismiss</Button>
            <Button variant="destructive">Deactivate</Button>
            <Button variant="link">View rota</Button>
          </Demo>
          <Demo label="Sizes" hint="size=">
            <Button size="xs">xs</Button>
            <Button size="sm">sm</Button>
            <Button size="default">default (40px)</Button>
            <Button size="lg">lg (44px)</Button>
            <Button size="icon" aria-label="Add">
              <Plus />
            </Button>
          </Demo>
          <Demo label="Loading & disabled" hint="loading">
            <LoadingButtonDemo />
            <Button disabled>Disabled</Button>
            <Button variant="outline" disabled>
              Disabled
            </Button>
          </Demo>
        </div>
      </Section>

      <Section
        id="motion"
        title="Motion"
        intro="Springy, never slick — and always a garnish, never a requirement (prefers-reduced-motion stills everything). Two easings: ease-spring for anything that ARRIVES (entrances, hover lifts, the press-and-release of a button), ease-out-soft for fades and colour. Three named animations: animate-pop (dialogs), animate-rise (staggered lists), animate-float (the idle bob on decorative coins)."
      >
        <Demo label="Entrances — animate-rise, staggered" className="block">
          <MotionDemo />
        </Demo>
      </Section>

      <Section
        id="status"
        title="Status idiom"
        intro="Three volumes, and which one to use is a decision, not a preference. A badge whispers (inline status in a table). An alert speaks up (a warning the admin must read). A destructive button shouts (a consequential action). The choir assigns the hues: meadow = done, sky = on its way, sunshine = now/attention, cherry = went wrong."
      >
        <div className="flex flex-col gap-4">
          <Demo label="Badge — the whisper" hint='variant="success" …'>
            <Badge variant="success">Delivered</Badge>
            <Badge variant="info">Queued</Badge>
            <Badge variant="warning">Sending</Badge>
            <Badge variant="destructive">Failed</Badge>
            <Badge>Today</Badge>
            <Badge variant="secondary">Fortnightly</Badge>
            <Badge variant="outline">Draft</Badge>
          </Demo>
          <Demo label="Alert — the raised voice" className="block">
            <Alert variant="warning" className="w-full">
              <TriangleAlert />
              <AlertTitle>Confirm your group&apos;s timezone.</AlertTitle>
              <AlertDescription>
                Reminders send at 9am in the group&apos;s timezone, and it has
                never been confirmed. Texts may arrive at the wrong hour until it
                is.
              </AlertDescription>
            </Alert>
          </Demo>
          <Demo label="Destructive button — the shout">
            <ConfirmDialog
              destructive
              trigger={<Button variant="destructive">Remove Dave</Button>}
              title="Remove Dave from the kitchen rota?"
              description="He holds 2 future shifts. They'll be reassigned to the next person in the order, and any cover he agreed to take is released."
              confirmLabel="Remove Dave"
              onConfirm={() => {
                toast.success("Dave removed. 2 shifts reassigned.");
              }}
            />
            <span className="text-muted-foreground text-xs">
              Confirm is solid and prominent; Cancel is the quiet default. Never
              the other way round.
            </span>
          </Demo>
        </div>
      </Section>

      <Section
        id="cards"
        title="Cards"
        intro="One idiom, everywhere: bg-card, a --border hairline, and a soft violet shadow-xs on pillowy corners. Every panel on this page is a <Card>. A card lifts off the page with border and shadow, not a lightness step a phone in daylight can't see. Titles speak in Fraunces."
      >
        <div className="grid gap-4 md:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Kitchen deep clean</CardTitle>
              <CardDescription>Every 2 weeks · Saturdays</CardDescription>
              <CardAction>
                <Badge variant="secondary">4 members</Badge>
              </CardAction>
            </CardHeader>
            <CardContent className="text-muted-foreground">
              Next up is <span className="text-foreground font-medium">Alice</span>{" "}
              on Saturday 4 July.
            </CardContent>
            <CardFooter>
              <Button variant="outline" size="sm">
                Edit rota
              </Button>
            </CardFooter>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Bins</CardTitle>
              <CardDescription>Weekly · Thursdays</CardDescription>
              <CardAction>
                <Badge variant="outline">Draft</Badge>
              </CardAction>
            </CardHeader>
            <CardContent className="text-muted-foreground">
              No one is on this rota yet, so nothing is scheduled.
            </CardContent>
            <CardFooter>
              <Button size="sm">Add members</Button>
            </CardFooter>
          </Card>
        </div>
      </Section>

      <Section
        id="empty"
        title="Empty & error states"
        intro="Every list has a day-one empty state, and every one of the five screens would draw it differently without a shared component. <EmptyState> is the single answer; error.tsx / not-found.tsx are built from it."
      >
        <div className="grid gap-4 md:grid-cols-2">
          <Demo label="EmptyState — with a way out" className="block">
            <EmptyState
              icon={Users}
              title="No members yet"
              description="Add the people who take turns. You can put them in any rota afterwards."
              action={
                <Button size="sm">
                  <Plus /> Add member
                </Button>
              }
            />
          </Demo>
          <Demo label="EmptyState — reassurance" className="block">
            <EmptyState
              icon={Inbox}
              title="You're all caught up"
              description="Nothing coming up for you right now. We'll text when it's your turn."
            />
          </Demo>
        </div>
      </Section>

      <Section
        id="table"
        title="Table, and the phone fallback"
        intro="Members, rotas, shifts and the SMS log are all tables, and a four-column table does not fit 375px. The pattern: a real <Table> from md up, a stack of <Card>s below it, from the SAME data. Resize the window to see it switch. Numerals are tabular everywhere, so dates don't jitter."
      >
        {/* md+ : the table */}
        <div className="border-border bg-card hidden overflow-hidden rounded-xl border md:block">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Rota</TableHead>
                <TableHead>Responsible</TableHead>
                <TableHead className="text-right">Reminder</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {SHIFTS.map((row) => {
                const s = SMS_STATUS[row.status];
                return (
                  <TableRow key={`${row.rota}-${row.who}`}>
                    <TableCell className="font-medium">
                      {formatShiftDate(row.date)}
                    </TableCell>
                    <TableCell className="text-muted-foreground">{row.rota}</TableCell>
                    <TableCell>
                      <span className="flex items-center gap-2">
                        <Avatar className="size-6">
                          <AvatarFallback className="text-[10px]">
                            {initials(row.who)}
                          </AvatarFallback>
                        </Avatar>
                        {row.who}
                        {row.cover ? (
                          <Badge variant="secondary">covering {row.cover}</Badge>
                        ) : null}
                      </span>
                    </TableCell>
                    <TableCell className="text-right">
                      <Badge variant={s.variant}>{s.label}</Badge>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>

        {/* below md : the card list */}
        <div className="flex flex-col gap-3 md:hidden">
          {SHIFTS.map((row) => {
            const s = SMS_STATUS[row.status];
            return (
              <Card key={`${row.rota}-${row.who}`} size="sm">
                <CardHeader>
                  <CardTitle className="text-sm">{row.rota}</CardTitle>
                  <CardDescription>{formatShiftDate(row.date)}</CardDescription>
                  <CardAction>
                    <Badge variant={s.variant}>{s.label}</Badge>
                  </CardAction>
                </CardHeader>
                <CardContent className="flex items-center gap-2">
                  <Avatar className="size-6">
                    <AvatarFallback className="text-[10px]">
                      {initials(row.who)}
                    </AvatarFallback>
                  </Avatar>
                  {row.who}
                  {row.cover ? (
                    <Badge variant="secondary">covering {row.cover}</Badge>
                  ) : null}
                </CardContent>
              </Card>
            );
          })}
        </div>
      </Section>

      <Section
        id="forms"
        title="Forms"
        intro="Field + react-hook-form + zod. This is the pattern, not a suggestion — five screens with five form libraries is exactly the incoherence this ticket exists to prevent. Submit it: the toast is Sonner."
      >
        <Demo label="Cover a shift" hint="Field · useForm · zodResolver">
          <CoverForm />
        </Demo>
      </Section>

      <Section id="inputs" title="Inputs & selects">
        <div className="grid gap-4 md:grid-cols-2">
          <Demo label="Input" className="block">
            <div className="w-full space-y-2">
              <Label htmlFor="sg-name">Name</Label>
              <Input id="sg-name" placeholder="Alice" />
            </div>
          </Demo>
          <Demo label="Input — invalid" className="block">
            <div className="w-full space-y-2">
              <Label htmlFor="sg-phone">Phone</Label>
              <Input id="sg-phone" defaultValue="07700 900" aria-invalid />
              <p className="text-destructive text-sm">
                Enter a valid mobile number.
              </p>
            </div>
          </Demo>
          <Demo label="Select" className="block">
            <div className="w-full space-y-2">
              <Label htmlFor="sg-interval">Repeats</Label>
              <Select defaultValue="2w">
                <SelectTrigger id="sg-interval" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="1w">Every week</SelectItem>
                  <SelectItem value="2w">Every 2 weeks</SelectItem>
                  <SelectItem value="1m">Every month</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </Demo>
          <Demo label="Disabled" className="block">
            <div className="w-full space-y-2">
              <Label htmlFor="sg-disabled">Magic link</Label>
              <Input
                id="sg-disabled"
                disabled
                defaultValue="x7Kd2p…"
                className="font-mono"
              />
            </div>
          </Demo>
        </div>
      </Section>

      <Section
        id="overlays"
        title="Overlays"
        intro="Dialog for a decision, Sheet for the mobile nav drawer, Popover and Dropdown for small choices. All four trap focus, close on Escape, and float on a token scrim with real elevation."
      >
        <Demo label="Dialog · Sheet · Popover · Dropdown · Toast">
          <Dialog>
            <DialogTrigger asChild>
              <Button variant="outline">Open dialog</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Rotate Alice&apos;s magic link?</DialogTitle>
                <DialogDescription>
                  Her current link stops working immediately. Use this if her
                  phone was lost. She&apos;ll get a fresh link by text.
                </DialogDescription>
              </DialogHeader>
            </DialogContent>
          </Dialog>

          <Sheet>
            <SheetTrigger asChild>
              <Button variant="outline">Open sheet</Button>
            </SheetTrigger>
            <SheetContent side="left" className="p-6">
              <SheetHeader className="p-0">
                <SheetTitle>Navigation</SheetTitle>
                <SheetDescription>
                  The drawer behind the hamburger, below md.
                </SheetDescription>
              </SheetHeader>
            </SheetContent>
          </Sheet>

          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline">Open popover</Button>
            </PopoverTrigger>
            <PopoverContent className="w-72">
              <p className="text-sm font-medium">Reminder offsets</p>
              <p className="text-muted-foreground mt-1 text-sm">
                Day-of is simply offset 0. Two requirements, one column.
              </p>
            </PopoverContent>
          </Popover>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" aria-label="Row actions">
                <MoreHorizontal />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              <DropdownMenuItem>Edit member</DropdownMenuItem>
              <DropdownMenuItem>Rotate magic link</DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive">Deactivate</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          <Button
            variant="outline"
            onClick={() =>
              toast.success("Bob has been texted.", {
                description: "He is covering Saturday 4 July.",
              })
            }
          >
            Toast
          </Button>
        </Demo>
      </Section>

      <Section
        id="dates"
        title="Dates & calendar"
        intro="Format every date through src/lib/date.ts, which pins BOTH locale and timezone. Never toLocaleDateString() in a component: unpinned, it resolves to the host — en-US on the Node server, en-GB in the browser, in two different zones — and server and client disagree on the day. On a product made of dates, that is a hydration mismatch and a wrong date at once."
      >
        <div className="grid gap-4 md:grid-cols-2">
          <Demo label="Formatters" hint="@/lib/date" className="block">
            <dl className="space-y-3 text-sm">
              {[
                { fn: "formatShiftDate", out: formatShiftDate(SAMPLE_DAY), use: "Shift lists, dashboard, member page." },
                { fn: "formatLongDate", out: formatLongDate(SAMPLE_DAY), use: "Confirmation copy, where ambiguity costs." },
                { fn: "formatTimestamp", out: formatTimestamp(SAMPLE_SENT_AT), use: "The SMS log, where the hour is the point." },
              ].map((f) => (
                <div key={f.fn}>
                  <code className="font-mono text-xs">{f.fn}()</code>
                  <p className="font-medium">{f.out}</p>
                  <p className="text-muted-foreground text-xs">{f.use}</p>
                </div>
              ))}
            </dl>
          </Demo>
          <Demo label="Calendar" hint="a rota's anchor date" className="justify-center">
            <Calendar
              mode="single"
              selected={date}
              onSelect={setDate}
              defaultMonth={new Date(2026, 6, 1)}
              className="border-border rounded-xl border"
            />
          </Demo>
        </div>
      </Section>

      <Section id="misc" title="Tabs, separator, avatar, skeleton">
        <div className="flex flex-col gap-4">
          <Demo label="Tabs" className="block">
            <Tabs defaultValue="upcoming" className="w-full">
              <TabsList>
                <TabsTrigger value="upcoming">Upcoming</TabsTrigger>
                <TabsTrigger value="past">Past</TabsTrigger>
              </TabsList>
              <TabsContent value="upcoming" className="text-muted-foreground pt-3 text-sm">
                Alice is up on Saturday.
              </TabsContent>
              <TabsContent value="past" className="text-muted-foreground pt-3 text-sm">
                History is immutable — it records who was actually responsible.
              </TabsContent>
            </Tabs>
          </Demo>

          <Demo label="Avatar">
            {MEMBERS.map((name) => (
              <span key={name} className="flex items-center gap-2">
                <Avatar>
                  <AvatarFallback>{initials(name)}</AvatarFallback>
                </Avatar>
                <span className="text-sm">{name}</span>
              </span>
            ))}
          </Demo>

          <Demo label="Separator" className="block">
            <div className="text-sm">
              Kitchen deep clean
              <Separator className="my-3" />
              <span className="text-muted-foreground">Every 2 weeks</span>
            </div>
          </Demo>

          <Demo label="Skeleton" className="block">
            <div className="space-y-2">
              <Skeleton className="h-4 w-48" />
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-10 w-full" />
            </div>
          </Demo>
        </div>
      </Section>

      <Section
        id="member"
        title="Member vocabulary"
        intro="The centre of the product: what someone sees after a text, on a phone, having not asked to be there. BLO-1055 assembles the member page from these. If the system can't express the fridge note, it isn't the right system — so it has to live here, exercised, not just in the admin shell."
      >
        <div className="mx-auto flex w-full max-w-md flex-col gap-5">
          <div>
            <p className="text-muted-foreground mb-2 text-xs font-medium">
              Your turn — offer to hand it on
            </p>
            <ShiftCard
              rota="Kitchen deep clean"
              date={SAMPLE_DAY}
              today={TODAY}
              state={{ kind: "yours" }}
              action={
                <Button size="lg" variant="outline" className="w-full">
                  Can&apos;t make it? Ask someone to cover
                </Button>
              }
            />
          </div>

          <div>
            <p className="text-muted-foreground mb-2 text-xs font-medium">
              You handed it on — you can take it back
            </p>
            <ShiftCard
              rota="Bins"
              date={new Date(2026, 6, 9)}
              today={TODAY}
              state={{ kind: "handed-off", to: "Bob" }}
              action={
                <Button size="sm" variant="ghost">
                  Actually, I can make it — take it back
                </Button>
              }
            />
          </div>

          <div>
            <p className="text-muted-foreground mb-2 text-xs font-medium">
              You&apos;re covering for someone
            </p>
            <ShiftCard
              rota="Bathroom"
              date={new Date(2026, 6, 11)}
              today={TODAY}
              state={{ kind: "covering", forName: "Cara" }}
            />
          </div>

          <div>
            <p className="text-muted-foreground mb-2 text-xs font-medium">
              A dead or rotated link
            </p>
            <InvalidLink />
          </div>
        </div>
      </Section>
    </div>
  );
}
