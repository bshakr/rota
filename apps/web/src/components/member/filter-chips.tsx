"use client";

import type { RotaFilter } from "@/app/(member)/s/[token]/schedule-view";
import type { RotaRef } from "@/lib/api/types";
import { cn } from "@/lib/utils";

/**
 * Everyone / Just me / one chip per rota. The chips WRAP onto a second line rather
 * than scrolling: unlike the people strip, a house has a handful of rotas and a
 * clipped one would hide a filter the member cannot discover any other way.
 *
 * "Everyone" is the clear: it resets the rota half of the filter. The person half is
 * cleared from the people strip, by tapping the selected avatar again.
 */
export function FilterChips({
  rotas,
  value,
  onChange,
}: {
  rotas: RotaRef[];
  value: RotaFilter;
  onChange: (next: RotaFilter) => void;
}) {
  const chips: { key: string; label: string; filter: RotaFilter }[] = [
    { key: "everyone", label: "Everyone", filter: { kind: "everyone" } },
    { key: "me", label: "Just me", filter: { kind: "me" } },
    ...rotas.map((rota) => ({
      key: `rota-${rota.id}`,
      label: rota.name,
      filter: { kind: "rota" as const, rotaId: rota.id },
    })),
  ];

  const isActive = (filter: RotaFilter) =>
    filter.kind === value.kind &&
    (filter.kind !== "rota" || value.kind !== "rota" || filter.rotaId === value.rotaId);

  return (
    <div className="flex flex-wrap gap-2" role="group" aria-label="Filter the rota">
      {chips.map((chip) => {
        const active = isActive(chip.filter);
        return (
          <button
            key={chip.key}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(chip.filter)}
            className={cn(
              "focus-visible:outline-ring inline-flex h-11 max-w-full items-center rounded-full px-4 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2",
              active
                ? "bg-primary text-primary-foreground shadow-xs"
                : "bg-secondary text-secondary-foreground hover:bg-lilac-deep",
            )}
          >
            <span className="truncate">{chip.label}</span>
          </button>
        );
      })}
    </div>
  );
}
