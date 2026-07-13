"use client";

import * as React from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { Controller, useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";
import { CalendarDays, MoreHorizontal, Plus, TriangleAlert } from "lucide-react";

import { Demo, Section } from "@/app/styleguide/_components/spec";
import {
  formatLongDate,
  formatShiftDate,
  formatTimestamp,
} from "@/lib/date";
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
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
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

const MEMBERS = ["Alice", "Bob", "Cara", "Dave"] as const;

// Fixed, never `new Date()`: a styleguide that renders a different thing every
// day is a styleguide you cannot diff.
const SAMPLE_DAY = new Date(2026, 6, 18);
const SAMPLE_SENT_AT = new Date(2026, 6, 15, 9, 0);

const initials = (name: string) => name.slice(0, 2).toUpperCase();

/* -------------------------------------------------------------------------- */
/* The canonical form. Copy this shape.                                        */
/* -------------------------------------------------------------------------- */

// One schema, one resolver, Field for layout. react-hook-form + zod are pinned
// by BLO-1042 precisely so that five screens do not arrive with five different
// form libraries. If you need a form, start here.
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
        {/*
          Controller, not form.watch(). Any input that is not a plain <input> —
          Select, Calendar, a drag-to-reorder roster — must go through Controller:
          it is the supported bridge for a controlled component, and calling
          watch() in render is flagged by the React Compiler as unmemoizable.
        */}
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

export function Gallery() {
  // A fixed date, not `new Date()`. The server and the browser evaluate a
  // useState initialiser independently, so "now" is two different instants and,
  // across a midnight boundary, two different days — a hydration mismatch that
  // would appear roughly once a day and never when you looked for it.
  const [date, setDate] = React.useState<Date | undefined>(
    new Date(2026, 6, 18),
  );

  return (
    <div className="flex flex-col gap-14">
      <Section
        id="buttons"
        title="Buttons"
        intro="Sizes run one step larger than stock shadcn. `lg` is 44px — the comfortable touch target — and is what the member page uses for its one real action. `xs` and `sm` are for table-row actions, which are mouse targets."
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
          <Demo label="States">
            <Button disabled>Disabled</Button>
            <Button variant="outline" disabled>
              Disabled
            </Button>
          </Demo>
        </div>
      </Section>

      <Section
        id="badges"
        title="Badges & status"
        intro="success / warning / info are HouseRota additions — stock shadcn ships only destructive. They exist so the SMS delivery log reads the same on every screen that shows it."
      >
        <div className="flex flex-col gap-4">
          <Demo label="Variants" hint="variant=">
            <Badge>Today</Badge>
            <Badge variant="secondary">Fortnightly</Badge>
            <Badge variant="outline">Draft</Badge>
          </Demo>
          <Demo label="SMS delivery status" hint="the four outcomes">
            <Badge variant="success">Delivered</Badge>
            <Badge variant="info">Queued</Badge>
            <Badge variant="warning">Sending</Badge>
            <Badge variant="destructive">Failed</Badge>
          </Demo>
        </div>
      </Section>

      <Section
        id="cards"
        title="Cards"
        intro="A card lifts off the page by getting lighter, not by casting a heavy shadow. The same rule holds in dark mode."
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
            <CardContent className="text-muted-foreground text-sm">
              Next up is <span className="text-foreground font-medium">Alice</span>{" "}
              on Saturday 5 July.
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
            <CardContent className="text-muted-foreground text-sm">
              No one is on this rota yet, so nothing is scheduled.
            </CardContent>
            <CardFooter>
              <Button size="sm">Add members</Button>
            </CardFooter>
          </Card>
        </div>
      </Section>

      <Section
        id="alerts"
        title="Alerts"
        intro="For consequences the admin must read before confirming — changing a schedule drops every agreed cover, and that must never be a surprise."
      >
        <div className="flex w-full flex-col gap-4">
          <Alert>
            <CalendarDays />
            <AlertTitle>Alice handed Saturday to Bob.</AlertTitle>
            <AlertDescription>
              Every remaining reminder now goes to Bob automatically.
            </AlertDescription>
          </Alert>
          <Alert variant="destructive">
            <TriangleAlert />
            <AlertTitle>Changing the schedule will drop 3 covers.</AlertTitle>
            <AlertDescription>
              The dates themselves move, so the shifts people agreed to cover
              will no longer exist. Roster changes preserve covers; schedule
              changes cannot.
            </AlertDescription>
          </Alert>
        </div>
      </Section>

      <Section
        id="table"
        title="Table"
        intro="Dates and names are the entire content of this product. Numerals are tabular everywhere, so columns of dates do not jitter."
      >
        <div className="border-border bg-card w-full overflow-hidden rounded-xl border">
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
              {[
                { date: "Sat 5 Jul", rota: "Kitchen deep clean", who: "Bob", cover: "Alice", status: "success" as const, label: "Delivered" },
                { date: "Thu 10 Jul", rota: "Bins", who: "Cara", cover: null, status: "info" as const, label: "Queued" },
                { date: "Sat 19 Jul", rota: "Kitchen deep clean", who: "Dave", cover: null, status: "destructive" as const, label: "Failed" },
              ].map((row) => (
                <TableRow key={`${row.rota}-${row.date}`}>
                  <TableCell className="font-medium">{row.date}</TableCell>
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
                    <Badge variant={row.status}>{row.label}</Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </Section>

      <Section
        id="forms"
        title="Forms"
        intro="Field + react-hook-form + zod. This is the pattern — not a suggestion. Five screens arriving with five form libraries is exactly the incoherence this ticket exists to prevent. Submit it: the toast is Sonner."
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
        intro="Dialog for a decision, Sheet for the mobile nav drawer, Popover and Dropdown for small choices. All four trap focus and close on Escape."
      >
        <Demo label="Dialog · Sheet · Popover · Dropdown">
          <Dialog>
            <DialogTrigger asChild>
              <Button variant="outline">Open dialog</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Remove Dave from the kitchen rota?</DialogTitle>
                <DialogDescription>
                  He holds 2 future shifts. They will be reassigned to the next
                  person in the order, and any cover he agreed to take will be
                  released.
                </DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <DialogClose asChild>
                  <Button variant="secondary">Keep him</Button>
                </DialogClose>
                <DialogClose asChild>
                  <Button variant="destructive">Remove Dave</Button>
                </DialogClose>
              </DialogFooter>
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
                  This is the drawer behind the hamburger in the admin shell,
                  below the md breakpoint.
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
              toast.success("Bob has been texted.", {
                description: "He is covering Saturday 5 July.",
              })
            }
          >
            Toast
          </Button>
        </Demo>
      </Section>

      <Section
        id="calendar"
        title="Dates & calendar"
        intro="Format every date through src/lib/date.ts. Never call toLocaleDateString() in a component: with no locale it resolves to the host default — en-US on the Node server, en-GB in the browser — and the two disagree, which is a hydration mismatch on a product made almost entirely of dates. The Calendar below is pinned to the same locale for exactly that reason."
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
              <TabsContent
                value="upcoming"
                className="text-muted-foreground pt-3 text-sm"
              >
                Alice is up on Saturday.
              </TabsContent>
              <TabsContent
                value="past"
                className="text-muted-foreground pt-3 text-sm"
              >
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
    </div>
  );
}
