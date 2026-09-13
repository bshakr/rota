"use client";

import * as React from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { Controller, useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";
import {
  Inbox,
  MessageCircle,
  MoreHorizontal,
  OctagonAlert,
  Plus,
  RotateCcw,
  TriangleAlert,
  Users,
} from "lucide-react";

import { Demo, Registers, Section } from "@/app/styleguide/_components/spec";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { EmptyState } from "@/components/empty-state";
import { InvalidLink } from "@/components/member/invalid-link";
import { NextShiftCard } from "@/components/member/next-shift-card";
import { ShiftRow } from "@/components/member/shift-row";
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
import type { MemberShift } from "@/lib/api/types";
import { formatLongDate, formatShiftDate, formatTimestamp } from "@/lib/date";
import { initials } from "@/lib/format";

// The cast, everywhere. Four housemates and three chores, so an example is
// never a lorem-ipsum name nobody can picture.
const MEMBERS = ["Bass", "Eliza", "Raph", "Ciara"] as const;

// Fixed dates, never `new Date()`: a styleguide that renders a different thing
// every day is a styleguide you cannot diff, and "today" evaluated on the server
// and the client can differ by a day across midnight.
const TODAY = new Date(2026, 6, 2);

// The member vocabulary is no longer a presentational card with loose props: the
// feed renders whole `MemberShift` records straight from the API, so the gallery
// exercises that real shape rather than a mock of it. Same 2 July 2026 as TODAY,
// as a CIVIL date, which is the only kind the member page deals in.
const MEMBER_TODAY = "2026-07-02";
const CIARA = { id: 1, name: "Ciara" };
const BASS = { id: 2, name: "Bass" };

function memberShift(
  shift: Partial<MemberShift> & { id: number; rota_name: string; due_on: string },
): MemberShift {
  const assigned = shift.assigned_member ?? CIARA;
  const covering = shift.covering_member ?? null;
  return {
    rota_id: 1,
    covered: covering !== null,
    assigned_member: assigned,
    covering_member: covering,
    responsible_member: covering ?? assigned,
    can_assign_cover: false,
    can_cancel_cover: false,
    ...shift,
  };
}

const MY_TURN = memberShift({
  id: 1,
  rota_name: "Kitchen deep clean",
  due_on: "2026-07-11",
  can_assign_cover: true,
});
const MY_NEXT_ONE = memberShift({ id: 2, rota_name: "Bathroom", due_on: "2026-07-18" });
const HANDED_OFF = memberShift({
  id: 3,
  rota_name: "Bins",
  due_on: "2026-07-07",
  covering_member: BASS,
  can_cancel_cover: true,
});
const SOMEONE_ELSES = memberShift({
  id: 4,
  rota_name: "Hoovering",
  due_on: "2026-07-07",
  assigned_member: BASS,
});
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
  {
    rota: "Kitchen deep clean",
    date: new Date(2026, 6, 4),
    who: "Raph",
    cover: "Ciara",
    status: "delivered",
  },
  {
    rota: "Bins",
    date: new Date(2026, 6, 7),
    who: "Bass",
    cover: null,
    status: "queued",
  },
  {
    rota: "Bathroom",
    date: new Date(2026, 6, 9),
    who: "Eliza",
    cover: null,
    status: "failed",
  },
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
            a drag-to-reorder roster) goes through Controller, the supported
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
                  {MEMBERS.filter((m) => m !== "Ciara").map((m) => (
                    <SelectItem key={m} value={m}>
                      {m}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          />
          <FieldDescription>
            They get a text with their own link. Nothing to accept.
          </FieldDescription>
          <FieldError errors={[errors.member]} />
        </Field>

        <Field data-invalid={Boolean(errors.note)}>
          <FieldLabel htmlFor="cover-note">Note (optional)</FieldLabel>
          <Input
            id="cover-note"
            placeholder="Away that weekend"
            {...form.register("note")}
          />
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

// The motion language, live. Remounting the row replays the entrances, which is
// the exact choreography the member page's shift list uses.
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
        <Button
          variant="secondary"
          size="sm"
          onClick={() => setRun((n) => n + 1)}
        >
          <RotateCcw /> Replay entrances
        </Button>
        <span className="text-muted-foreground text-xs">
          Cards rise and settle on a spring, and lists stagger by about 90ms per
          item. Hover a button to feel the lift, press it to feel the squash.
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
      {loading ? "Asking Raph…" : "Ask Raph to cover"}
    </Button>
  );
}

/* -------------------------------------------------------------------------- */

export function Gallery() {
  const [date, setDate] = React.useState<Date | undefined>(SAMPLE_DAY);

  return (
    <div className="flex flex-col gap-14">
      <Section
        id="voice"
        title="Voice"
        intro="It sounds like a note from a housemate, not a product. Short sentences, gentle, never sarcastic at the person reading. British spelling. No em dashes anywhere a user can read: a full stop, a comma or a colon instead. At most one emoji, and only inside an SMS template."
      >
        <div className="grid gap-4 md:grid-cols-2">
          <Demo label="The text someone gets" hint="SMS template" className="block">
            <div className="w-full">
              <div className="bg-mint text-plum rounded-3xl rounded-bl-lg p-4 text-sm shadow-xs">
                Hi Ciara 🌷 you&apos;re up for Kitchen deep clean this Saturday.
                Can&apos;t make it? Tap to hand it on.
              </div>
              <p className="text-muted-foreground mt-3 text-xs text-pretty">
                The one emoji the system allows, and this is where it goes. A
                template renders{" "}
                <code className="font-mono">
                  {"{{name}} {{rota}} {{date}} {{days_until}}"}
                </code>
                , so keep the placeholders and keep it under one screen.
              </p>
            </div>
          </Demo>
          <Demo label="Say it like this, not like that" className="block">
            <dl className="w-full space-y-3 text-sm">
              {[
                {
                  good: "Whose turn? Sorted.",
                  bad: "Effortless chore management, delightfully seamless.",
                },
                {
                  good: "That page wandered off.",
                  bad: "404: the requested resource could not be located.",
                },
                {
                  good: "Nobody has to nag.",
                  bad: "Automated accountability workflows.",
                },
              ].map((line) => (
                <div key={line.good}>
                  <dt className="text-foreground font-medium">{line.good}</dt>
                  <dd className="text-muted-foreground text-xs line-through">
                    {line.bad}
                  </dd>
                </div>
              ))}
            </dl>
          </Demo>
        </div>
      </Section>

      <Section
        id="buttons"
        title="Buttons"
        intro="Pills, and tactile. The default is a grape fill with a white label wearing the primary clay, deepening as it lifts on hover and squashing on press, all stilled under reduced motion. Secondary is a lilac fill with plum text, outline is white with a plum boundary, and ghost hovers to a lilac blush. lg is 44px, the comfortable touch target and the member page's CTA size. default at 40px is the admin workhorse, and xs and sm are mouse-target sizes. loading shows a spinner, disables the button and sets aria-busy."
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
            <Button size="icon-sm" variant="outline" aria-label="Add">
              <Plus />
            </Button>
            <Button size="icon-lg" variant="ghost" aria-label="Add">
              <Plus />
            </Button>
          </Demo>
          <Demo label="Loading and disabled" hint="loading">
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
        intro="Springy, never slick, and always a garnish rather than a requirement, since prefers-reduced-motion stills all of it. Two easings: ease-spring for anything that ARRIVES, ease-out-soft for fades and colour. Three named animations: animate-pop for dialogs and heroes, animate-rise for staggered lists, animate-bob for the slow idle drift on decorative blobs and coins."
      >
        <Demo label="Entrances, staggered" hint="animate-rise" className="block">
          <MotionDemo />
        </Demo>
      </Section>

      <Section
        id="status"
        title="Status idiom"
        intro="Three volumes, and which one to use is a decision rather than a preference. A badge whispers, for inline status in a table. An alert speaks up, for something the admin has to read. A destructive button shouts, for a consequential action. The stickers assign the hues: mint is done, sky is on its way, lemon is now, blush went wrong."
      >
        <div className="flex flex-col gap-4">
          <Registers>
            <div className="flex flex-col gap-4">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="success">Delivered</Badge>
                <Badge variant="info">Queued</Badge>
                <Badge variant="warning">Sending</Badge>
                <Badge variant="destructive">Failed</Badge>
                <Badge>Today</Badge>
                <Badge variant="secondary">Fortnightly</Badge>
                <Badge variant="outline">Draft</Badge>
                <Badge variant="ghost">Paused</Badge>
              </div>
              <Alert variant="warning">
                <TriangleAlert />
                <AlertTitle>Confirm your house&apos;s timezone.</AlertTitle>
                <AlertDescription>
                  Reminders send at 9am in the house&apos;s timezone, and it has
                  never been confirmed. Texts may land at the wrong hour until it
                  is.
                </AlertDescription>
              </Alert>
              <Alert variant="destructive">
                <OctagonAlert />
                <AlertTitle>1 person didn&apos;t get a text</AlertTitle>
                <AlertDescription>
                  Bass had a reminder fail to send. A text that fails quietly is
                  worse than no rota, so check the carrier error.
                </AlertDescription>
              </Alert>
            </div>
          </Registers>

          <Demo label="Alert, the other tones" className="block">
            <div className="w-full space-y-3">
              <Alert>
                <MessageCircle />
                <AlertTitle>Nothing is scheduled yet</AlertTitle>
                <AlertDescription>
                  Add someone to this rota and the first turn appears straight
                  away.
                </AlertDescription>
              </Alert>
              <Alert variant="success">
                <MessageCircle />
                <AlertTitle>Everyone has been texted</AlertTitle>
                <AlertDescription>
                  Four reminders went out this morning. Nothing to do.
                </AlertDescription>
              </Alert>
              <Alert variant="info">
                <MessageCircle />
                <AlertTitle>Ciara handed Saturday on</AlertTitle>
                <AlertDescription>
                  Raph is covering the kitchen deep clean, and has his own link.
                </AlertDescription>
              </Alert>
            </div>
          </Demo>

          <Demo label="Destructive button, the shout">
            <ConfirmDialog
              destructive
              trigger={<Button variant="destructive">Remove Eliza</Button>}
              title="Remove Eliza from the bathroom rota?"
              description="She holds 2 future turns. They go to the next person in the order, and any cover she agreed to take is released."
              confirmLabel="Remove Eliza"
              onConfirm={() => {
                toast.success("Eliza removed. 2 turns reassigned.");
              }}
            />
            <span className="text-muted-foreground text-xs">
              Confirm is solid and prominent, Cancel is the quiet default. Never
              the other way round.
            </span>
          </Demo>
        </div>
      </Section>

      <Section
        id="cards"
        title="Cards"
        intro="One idiom everywhere: a white surface at 24px, a plum hairline, and the card clay. Every panel on this page is a Card, so the reference for a panel is the component itself. A card lifts off the page on shadow and shape rather than a lightness step a phone in daylight cannot see. Titles speak in Fredoka."
      >
        <div className="grid gap-4 md:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Kitchen deep clean</CardTitle>
              <CardDescription>Every 2 weeks · Saturdays</CardDescription>
              <CardAction>
                <Badge variant="secondary">4 people</Badge>
              </CardAction>
            </CardHeader>
            <CardContent className="text-muted-foreground">
              Next up is{" "}
              <span className="text-foreground font-medium">Raph</span> on
              Saturday 4 July.
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
              <CardDescription>Weekly · Tuesdays</CardDescription>
              <CardAction>
                <Badge variant="outline">Draft</Badge>
              </CardAction>
            </CardHeader>
            <CardContent className="text-muted-foreground">
              Nobody is on this rota yet, so nothing is scheduled.
            </CardContent>
            <CardFooter>
              <Button size="sm">Add people</Button>
            </CardFooter>
          </Card>
        </div>
      </Section>

      <Section
        id="empty"
        title="Empty and error states"
        intro="Every list has a day-one empty state, and all five screens would draw it differently without a shared component. EmptyState is the single answer, with a peach clay coin holding the icon. error.tsx and not-found.tsx are built from it."
      >
        <div className="grid gap-4 md:grid-cols-2">
          <Demo label="EmptyState, with a way out" className="block">
            <EmptyState
              icon={Users}
              title="No rotas yet"
              description="Add the first chore and who takes turns. We'll handle the reminders."
              action={
                <Button size="sm">
                  <Plus /> Add a rota
                </Button>
              }
            />
          </Demo>
          <Demo label="EmptyState, reassurance" className="block">
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
        intro="Members, rotas, shifts and the SMS log are all tables, and a four-column table does not fit a 390px phone. The pattern: a real Table from md up, a stack of Cards below it, from the same data. Resize the window to watch it switch. Rows are hairline ruled, the header is Outfit at 600, and there is no zebra."
      >
        {/* md and up: the table */}
        <div className="border-border bg-card hidden overflow-hidden rounded-2xl border shadow-sm md:block">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Rota</TableHead>
                <TableHead>Whose turn</TableHead>
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
                    <TableCell className="text-muted-foreground">
                      {row.rota}
                    </TableCell>
                    <TableCell>
                      <span className="flex items-center gap-2">
                        <Avatar className="size-6">
                          <AvatarFallback className="text-[10px]">
                            {initials(row.who)}
                          </AvatarFallback>
                        </Avatar>
                        {row.who}
                        {row.cover ? (
                          <Badge variant="secondary">
                            covering {row.cover}
                          </Badge>
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

        {/* below md: the card list */}
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
        intro="Field plus react-hook-form plus zod. This is the pattern, not a suggestion: five screens with five form libraries is exactly the incoherence the system exists to prevent. Controls are pills on a white fill with the plum input boundary, and the focus ring sits in an offset gap. Submit it, and the toast is Sonner."
      >
        <Demo label="Cover a shift" hint="Field · useForm · zodResolver">
          <CoverForm />
        </Demo>
      </Section>

      <Section id="inputs" title="Inputs and selects">
        <div className="grid gap-4 md:grid-cols-2">
          <Demo label="Input" className="block">
            <div className="w-full space-y-2">
              <Label htmlFor="sg-name">Name</Label>
              <Input id="sg-name" placeholder="Ciara" />
            </div>
          </Demo>
          <Demo label="Input, invalid" className="block">
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
        intro="Dialog for a decision, Sheet for the mobile nav drawer, Popover and Dropdown for small choices. All four sit at 28px on the lift clay, trap focus, close on Escape, and float over a plum scrim."
      >
        <Demo label="Dialog · Sheet · Popover · Dropdown · Toast">
          <Dialog>
            <DialogTrigger asChild>
              <Button variant="outline">Open dialog</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Rotate Ciara&apos;s magic link?</DialogTitle>
                <DialogDescription>
                  Her current link stops working straight away. Use this if her
                  phone went missing. She gets a fresh link by text.
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
              <DropdownMenuItem variant="destructive">
                Deactivate
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          <Button
            variant="outline"
            onClick={() =>
              toast.success("Raph has been texted.", {
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
        title="Dates and calendar"
        intro="Format every date through src/lib/date.ts, which pins both locale and timezone. Never toLocaleDateString() in a component: unpinned it resolves to the host, which is en-US on the Node server and en-GB in the browser, in two different zones, so server and client disagree on the day. On a product made of dates that is a hydration mismatch and a wrong date at once."
      >
        <div className="grid gap-4 md:grid-cols-2">
          <Demo label="Formatters" hint="@/lib/date" className="block">
            <dl className="space-y-3 text-sm">
              {[
                {
                  fn: "formatShiftDate",
                  out: formatShiftDate(SAMPLE_DAY),
                  use: "Shift lists, the dashboard, the member page.",
                },
                {
                  fn: "formatLongDate",
                  out: formatLongDate(SAMPLE_DAY),
                  use: "Confirmation copy, where ambiguity costs.",
                },
                {
                  fn: "formatTimestamp",
                  out: formatTimestamp(SAMPLE_SENT_AT),
                  use: "The SMS log, where the hour is the point.",
                },
              ].map((f) => (
                <div key={f.fn}>
                  <code className="font-mono text-xs">{f.fn}()</code>
                  <p className="font-medium">{f.out}</p>
                  <p className="text-muted-foreground text-xs">{f.use}</p>
                </div>
              ))}
            </dl>
          </Demo>
          <Demo
            label="Calendar"
            hint="a rota's anchor date"
            className="justify-center"
          >
            <Calendar
              mode="single"
              selected={date}
              onSelect={setDate}
              defaultMonth={new Date(2026, 6, 1)}
              className="border-border rounded-2xl border"
            />
          </Demo>
        </div>
      </Section>

      <Section
        id="coins"
        title="Day coins"
        intro="The dashboard's week glance colours a day by urgency rather than by status: peach is today, lemon is tomorrow, lilac is anything later. The member page's shift card uses the same coin to carry cover state instead: peach for a turn that is yours, sky when you are covering, quiet fill once you have handed it on. Coins are stickers, so they stay peach at night and their numerals stay plum."
      >
        <Demo label="Urgency, on the dashboard" className="block">
          <div className="flex flex-wrap gap-3">
            {[
              { cls: "bg-peach", day: "2", month: "Jul", when: "Today" },
              { cls: "bg-lemon", day: "3", month: "Jul", when: "Tomorrow" },
              { cls: "bg-lilac", day: "4", month: "Jul", when: "Saturday" },
              { cls: "bg-lilac", day: "7", month: "Jul", when: "Tuesday" },
            ].map((c) => (
              <div key={c.day} className="flex flex-col items-center gap-2">
                <span
                  className={`${c.cls} text-plum font-heading flex size-14 flex-col items-center justify-center rounded-xl leading-none font-semibold shadow-xs`}
                >
                  <span className="text-lg">{c.day}</span>
                  <span className="text-[10px] tracking-wide uppercase">
                    {c.month}
                  </span>
                </span>
                <span className="text-muted-foreground text-xs">{c.when}</span>
              </div>
            ))}
          </div>
        </Demo>
      </Section>

      <Section id="misc" title="Tabs, separator, avatar, skeleton">
        <div className="flex flex-col gap-4">
          <Demo label="Tabs" className="block">
            <Tabs defaultValue="upcoming" className="w-full">
              <TabsList>
                <TabsTrigger value="upcoming">Upcoming</TabsTrigger>
                <TabsTrigger value="past">Past</TabsTrigger>
              </TabsList>
              <TabsContent
                value="upcoming"
                className="text-muted-foreground pt-3 text-sm"
              >
                Raph is up on Saturday.
              </TabsContent>
              <TabsContent
                value="past"
                className="text-muted-foreground pt-3 text-sm"
              >
                History is immutable. It records who was actually responsible.
              </TabsContent>
            </Tabs>
          </Demo>

          <Demo label="Avatar" hint="pastel tint from avatar-tint">
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

          <Demo label="Skeleton" hint="quiet fill pills" className="block">
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
        intro="The centre of the product: what Ciara sees after a text, on a phone, having not asked to be there. If the system cannot express the fridge note, it is not the right system, so it has to live here and be exercised rather than only described."
      >
        <div className="mx-auto flex w-full max-w-md flex-col gap-5">
          <div>
            <p className="font-heading text-2xl font-semibold">Hi Ciara</p>
            <p className="text-muted-foreground text-sm">
              2 July 2026. Here&apos;s what the whole house is up to.
            </p>
          </div>

          <div>
            <p className="text-muted-foreground mb-2 text-xs font-medium">
              Your next turn, with the offer to hand it on
            </p>
            <NextShiftCard
              shifts={[MY_TURN, MY_NEXT_ONE]}
              viewerId={CIARA.id}
              today={MEMBER_TODAY}
              onHandOff={(shift) => toast(`Hand off ${shift.rota_name}`)}
            />
          </div>

          <div>
            <p className="text-muted-foreground mb-2 text-xs font-medium">
              Nothing on your plate, which is a reassurance and not an error
            </p>
            <NextShiftCard
              shifts={[]}
              viewerId={CIARA.id}
              today={MEMBER_TODAY}
              onHandOff={(shift) => toast(`Hand off ${shift.rota_name}`)}
            />
          </div>

          <div>
            <p className="text-muted-foreground mb-2 text-xs font-medium">
              A day in the feed: your row is lit, the rest of the house stays quiet
            </p>
            <Card className="gap-0 overflow-hidden py-0">
              <ul className="divide-border divide-y">
                {[MY_TURN, HANDED_OFF, SOMEONE_ELSES].map((shift) => (
                  <ShiftRow
                    key={shift.id}
                    shift={shift}
                    viewerId={CIARA.id}
                    onHandOff={(handed) => toast(`Hand off ${handed.rota_name}`)}
                    onTakeBack={(taken) => toast(`Take back ${taken.rota_name}`)}
                  />
                ))}
              </ul>
            </Card>
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
