import Link from "next/link";
import { OctagonAlert, TriangleAlert } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import type { DashboardWarning } from "@/lib/dashboard";

// The severity chosen by the collector maps to both the Alert tone and its icon:
// a warning triangle for the quiet-but-costly problems, a stop sign for a failed
// text (the one that actually cost someone their reminder).
const ICON = { warning: TriangleAlert, destructive: OctagonAlert } as const;

/**
 * The dashboard's warning surface. Each entry is an `Alert` — the "raised voice"
 * of the status idiom — with the fix one click away in its description. Rendering
 * only; every decision about what to warn and how loudly lives in
 * `collectDashboardWarnings`.
 */
export function DashboardWarnings({ warnings }: { warnings: DashboardWarning[] }) {
  if (warnings.length === 0) return null;

  return (
    <div className="mb-8 space-y-3">
      {warnings.map((warning) => {
        const Icon = ICON[warning.severity];
        return (
          <Alert key={warning.id} variant={warning.severity}>
            <Icon aria-hidden />
            <AlertTitle>{warning.title}</AlertTitle>
            <AlertDescription>
              {warning.description}{" "}
              <Link href={warning.href}>{warning.action}</Link>
            </AlertDescription>
          </Alert>
        );
      })}
    </div>
  );
}
