"use client";

import * as React from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  GROUP_STATUS_OPTIONS,
  type GroupStatus,
  type GroupsFilters as Filters,
  NO_FILTERS,
  groupsHref,
  hasNarrowingFilters,
} from "@/lib/hq-groups";

// The list is fetched server-side (the operator client is `server-only`), so a
// filter is nothing but a change to the URL: pick a value, the query string
// updates, the server re-fetches and re-renders. That keeps the token off the
// client and makes a filtered view shareable and bookmarkable.
//
// `router.replace`, not `push`, exactly as the house's SMS log does it: narrowing
// a list is not navigation, so it leaves no history entry and Back takes the
// operator off the list rather than walking them back out through every filter
// they tried on the way in.
//
// The current state arrives as a PROP rather than out of `useSearchParams`. The
// server has already parsed and validated it (`parseGroupsFilters`), so reading
// the raw query string again here would be a second, laxer answer to the same
// question — and it is exactly how a bar ends up showing a status the page
// ignored. It also means this component needs no Suspense boundary and renders
// identically from a fixture, which is how its screenshots are taken.

// A Radix Select item may not carry an empty-string value, so "no filter" is a
// real sentinel we translate back to a cleared field.
const ALL = "all";

export function GroupsFilters({ filters }: { filters: Filters }) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();

  const go = React.useCallback(
    (next: Filters) => {
      startTransition(() => router.replace(groupsHref(next), { scroll: false }));
    },
    [router],
  );

  const narrowed = hasNarrowingFilters(filters);

  return (
    <div className="mb-6 flex flex-col gap-3" aria-busy={pending}>
      <form
        // Submit, not keystroke. A search that fires per character asks Rails for
        // "a", "al", "alm" before it ever asks for "alma", and every one of those
        // is an unscoped read across every house in the database.
        onSubmit={(event) => {
          event.preventDefault();
          const typed = new FormData(event.currentTarget).get("q");
          go({ ...filters, q: String(typed ?? "").trim() });
        }}
        className="flex flex-wrap items-center gap-2"
        role="search"
      >
        <Input
          // UNCONTROLLED, and keyed on the committed term. The box is read on
          // submit, so it needs no state at all; the key is what resets it when
          // the committed term changes underneath it — pressing "Clear filters"
          // with a word still in the box, or arriving on a different URL — rather
          // than an effect that would have to chase the prop.
          key={filters.q}
          type="search"
          name="q"
          defaultValue={filters.q}
          disabled={pending}
          aria-label="Search houses by name or slug"
          placeholder="Name or slug…"
          className="w-full sm:w-64"
        />
        <Button type="submit" variant="secondary" disabled={pending}>
          Search
        </Button>
      </form>

      <div className="flex flex-wrap items-center gap-2">
        <Select
          value={filters.status ?? ALL}
          disabled={pending}
          onValueChange={(value) =>
            go({ ...filters, status: value === ALL ? null : (value as GroupStatus) })
          }
        >
          <SelectTrigger size="sm" aria-label="Filter by status" className="w-auto min-w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All statuses</SelectItem>
            {GROUP_STATUS_OPTIONS.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Toggle
          label="Timezone unconfirmed"
          on={filters.unconfirmedTimezone}
          disabled={pending}
          onToggle={() => go({ ...filters, unconfirmedTimezone: !filters.unconfirmedTimezone })}
        />
        <Toggle
          label="Has failures"
          on={filters.hasFailures}
          disabled={pending}
          onToggle={() => go({ ...filters, hasFailures: !filters.hasFailures })}
        />

        {narrowed ? (
          <Button
            variant="ghost"
            size="sm"
            disabled={pending}
            // The SORT survives a clear. It is how the operator is reading the
            // list, not a way of narrowing it, and throwing it away would reorder
            // the page under them as a side effect of removing a filter.
            onClick={() => go({ ...NO_FILTERS, sort: filters.sort })}
          >
            Clear filters
          </Button>
        ) : null}
      </div>
    </div>
  );
}

/**
 * A filter that is on or off. A real `aria-pressed` button rather than a styled
 * checkbox: it is announced as a toggle, it is one tap at 44px, and "on" is
 * carried by the lilac secondary fill the rest of the system uses for a pressed
 * state — never by colour alone, since the label says what it filters either way.
 */
function Toggle({
  label,
  on,
  disabled,
  onToggle,
}: {
  label: string;
  on: boolean;
  disabled: boolean;
  onToggle: () => void;
}) {
  return (
    <Button
      type="button"
      size="sm"
      variant={on ? "secondary" : "outline"}
      aria-pressed={on}
      disabled={disabled}
      onClick={onToggle}
    >
      {label}
    </Button>
  );
}
