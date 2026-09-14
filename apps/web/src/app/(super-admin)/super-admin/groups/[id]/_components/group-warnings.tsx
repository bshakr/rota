import { CircleCheck } from "lucide-react";

import { DashboardWarnings } from "@/components/dashboard-warnings";
import type { WarningsInput } from "@/lib/api/super-admin-groups";
import { collectDashboardWarnings } from "@/lib/dashboard";
import {
  GROUP_SECTION,
  OPERATOR_SETTINGS_HREF,
  WARNINGS_NONE,
  WARNINGS_NOTE,
  operatorWarning,
} from "@/lib/hq-group-report";

/**
 * What this house's own admins are being warned about, on the operator's screen.
 *
 * The plan asks for this in one sentence — "Warnings, from
 * `collectDashboardWarnings` with the same inputs, so the operator sees exactly
 * the alerts the house admin sees" — and every part of that sentence is load
 * bearing, so nothing here restates a rule:
 *
 *   - the FACTS are `report.warnings_input`, which `SuperAdmin::WarningsInput`
 *     composes from the house's OWN serializers (`::GroupSerializer`,
 *     `::RotaSerializer`, `::MemberSerializer`, and the log's failed page), not
 *     from the operator's;
 *   - the JUDGEMENT is `collectDashboardWarnings`, the same function the house's
 *     dashboard runs, imported and not copied;
 *   - the RENDERING is `DashboardWarnings`, the same component, so a warning that
 *     shouts in blush on one screen shouts in blush on the other.
 *
 * A redundant warning here would be a nuisance; a MISSED one is the reason this
 * screen exists at all. That is why none of the three is reimplemented, and why
 * the API composes the input rather than the page picking fields out of the
 * operator's own payload — which would drift the first time a warning learned to
 * read a new column.
 *
 * The one thing that does change is where "fix it" goes: see `operatorWarning`.
 *
 * Nothing arrives here as an empty card. "Nothing is wrong" is a real answer to
 * the question this section asks and the operator needs to be told it, rather
 * than left to wonder whether the warnings failed to load.
 */
export function GroupWarnings({ input }: { input: WarningsInput }) {
  const warnings = collectDashboardWarnings({
    group: input.group,
    rotas: input.rotas,
    members: input.members,
    // Rails' key is `failed_sms`, the collector's is `failedSms` — the rename is
    // the whole adaptation, and it is here rather than in the schema so the schema
    // keeps saying exactly what Rails sends.
    failedSms: input.failed_sms,
    // The house passes its own settings route. There isn't one here; the same
    // three fields are behind "Rename & timezone" in this page's header.
    settingsHref: OPERATOR_SETTINGS_HREF,
  }).map(operatorWarning);

  // No bottom margin on the section: `DashboardWarnings` carries its own, and the
  // empty line matches it, so both states leave the same gap under the heading.
  return (
    <section id={GROUP_SECTION.warnings} className="scroll-mt-24">
      <h2 className="font-heading mb-1 text-lg font-semibold">What this house is being told</h2>
      <p className="text-muted-foreground mb-3 max-w-prose text-sm text-pretty">{WARNINGS_NOTE}</p>

      {warnings.length === 0 ? (
        <p className="text-muted-foreground bg-muted/60 mb-8 flex items-start gap-2 rounded-xl px-4 py-3 text-sm text-pretty">
          <CircleCheck className="mt-0.5 size-4 shrink-0" aria-hidden />
          {WARNINGS_NONE}
        </p>
      ) : (
        <DashboardWarnings warnings={warnings} />
      )}
    </section>
  );
}
