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

// The log is fetched server-side (the admin client is server-only), so a filter
// is just a change to the URL: pick a value, the query string updates, the server
// re-fetches and re-renders. That keeps the token off the client, makes a filtered
// view shareable and bookmarkable, and means back/forward move between filters.
//
// The param names here are the ones the page reads and forwards to the API.

type Option = { value: string; label: string };

// A Radix Select item may not have an empty-string value, so "no filter" is a
// real sentinel we translate back to a deleted param.
const ALL = "all";

const STATUS_OPTIONS: Option[] = [
  { value: "delivered", label: "Delivered" },
  { value: "sent", label: "Sent" },
  { value: "sending", label: "Sending" },
  { value: "pending", label: "Queued" },
  { value: "failed", label: "Failed" },
];

const KIND_OPTIONS: Option[] = [
  { value: "reminder", label: "Reminder" },
  { value: "cover_notice", label: "Cover notice" },
];

const FILTER_KEYS = ["status", "kind", "member_id", "rota_id"] as const;

export function SmsFilters({
  members,
  rotas,
}: {
  members: MemberRef[];
  rotas: MemberRef[];
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
      startTransition(() => router.replace(qs ? `/sms?${qs}` : "/sms", { scroll: false }));
    },
    [router],
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
        options={STATUS_OPTIONS}
        disabled={pending}
        onValueChange={(v) => setParam("status", v)}
      />
      <FilterSelect
        ariaLabel="Filter by message type"
        allLabel="All types"
        value={params.get("kind") ?? ALL}
        options={KIND_OPTIONS}
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
  options: Option[];
  disabled: boolean;
  onValueChange: (value: string) => void;
}) {
  return (
    <Select value={value} onValueChange={onValueChange} disabled={disabled}>
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
