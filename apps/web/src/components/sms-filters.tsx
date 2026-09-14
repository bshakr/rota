"use client";

import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";

import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { MemberRef } from "@/lib/api/types";
import { SMS_KIND_OPTIONS, SMS_STATUS_OPTIONS } from "@/lib/sms-display";

// The log is fetched server-side (the admin client is server-only), so a filter
// is just a change to the URL: pick a value, the query string updates, the server
// re-fetches and re-renders. That keeps the token off the client, makes a filtered
// view shareable and bookmarkable, and means back/forward move between filters.
//
// The param names here are the ones the page reads and forwards to the API.
//
// It lives in `components/` rather than beside /sms because TWO screens narrow the
// same rows the same way: the house's own log, and the operator's redacted view of
// one house's log on the group page
// (https://linear.app/bloombase/issue/BLO-1680). `basePath` is the whole
// difference between them — the API filters are shared by
// `SmsMessageFiltering` on the Rails side for exactly the same reason, so that an
// operator is never debugging a house against a different set of rows than the
// admin who reported the problem. The option lists come from `lib/sms-display.ts`
// so the menu and the page's own validation cannot offer different values.

type Option = { value: string; label: string };

// A Radix Select item may not have an empty-string value, so "no filter" is a
// real sentinel we translate back to a deleted param.
const ALL = "all";

const FILTER_KEYS = ["status", "kind", "member_id", "rota_id"] as const;

export function SmsFilters({
  members,
  rotas,
  basePath = "/sms",
}: {
  members: MemberRef[];
  rotas: MemberRef[];
  /**
   * Where a narrowed log lives. The house's own is "/sms"; the operator's is that
   * one house's page, "/super-admin/groups/12". The query string is identical
   * either way, which is the point.
   */
  basePath?: string;
}) {
  const router = useRouter();
  const params = useSearchParams();
  const [pending, startTransition] = React.useTransition();

  const navigate = React.useCallback(
    (next: URLSearchParams) => {
      // A filter change always resets pagination — otherwise a widened filter
      // would keep an inflated limit from a previous, narrower view.
      next.delete("limit");
      const qs = next.toString();
      startTransition(() => router.replace(qs ? `${basePath}?${qs}` : basePath, { scroll: false }));
    },
    [router, basePath],
  );

  function setParam(key: string, value: string) {
    const next = new URLSearchParams(params.toString());
    if (value === ALL) next.delete(key);
    else next.set(key, value);
    navigate(next);
  }

  const hasFilters = FILTER_KEYS.some((k) => params.has(k));

  return (
    <div className="mb-6 flex flex-wrap items-center gap-2" aria-busy={pending}>
      <FilterSelect
        ariaLabel="Filter by delivery status"
        allLabel="All statuses"
        value={params.get("status") ?? ALL}
        options={SMS_STATUS_OPTIONS}
        disabled={pending}
        onValueChange={(v) => setParam("status", v)}
      />
      <FilterSelect
        ariaLabel="Filter by message type"
        allLabel="All types"
        value={params.get("kind") ?? ALL}
        options={SMS_KIND_OPTIONS}
        disabled={pending}
        onValueChange={(v) => setParam("kind", v)}
      />
      <FilterSelect
        ariaLabel="Filter by member"
        allLabel="All members"
        value={params.get("member_id") ?? ALL}
        options={members.map((m) => ({ value: String(m.id), label: m.name }))}
        disabled={pending}
        onValueChange={(v) => setParam("member_id", v)}
      />
      <FilterSelect
        ariaLabel="Filter by rota"
        allLabel="All rotas"
        value={params.get("rota_id") ?? ALL}
        options={rotas.map((r) => ({ value: String(r.id), label: r.name }))}
        disabled={pending}
        onValueChange={(v) => setParam("rota_id", v)}
      />
      {hasFilters ? (
        <Button
          variant="ghost"
          size="sm"
          disabled={pending}
          onClick={() => navigate(new URLSearchParams())}
        >
          Clear filters
        </Button>
      ) : null}
    </div>
  );
}

function FilterSelect({
  ariaLabel,
  allLabel,
  value,
  options,
  disabled,
  onValueChange,
}: {
  ariaLabel: string;
  allLabel: string;
  value: string;
  options: readonly Option[];
  disabled: boolean;
  onValueChange: (value: string) => void;
}) {
  // A stale or hand-edited URL can carry a value that no longer matches any
  // option (a removed member, a status the page validated away). Show "All …"
  // for it rather than an empty trigger — the page ignores it too.
  const selected = options.some((o) => o.value === value) ? value : ALL;
  return (
    <Select value={selected} onValueChange={onValueChange} disabled={disabled}>
      <SelectTrigger size="sm" aria-label={ariaLabel} className="w-auto min-w-36">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={ALL}>{allLabel}</SelectItem>
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
