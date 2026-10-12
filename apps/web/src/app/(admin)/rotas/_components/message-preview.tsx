"use client";

import * as React from "react";
import { type Control, useWatch } from "react-hook-form";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { apiErrorMessage } from "@/lib/api/errors";

import { previewMessageAction } from "../actions";
import type { RotaFormValues } from "./rota-details-form";

const DEBOUNCE_MS = 400;

type PreviewState =
  | { status: "loading" }
  | { status: "ok"; text: string }
  | { status: "error"; message: string };

/**
 * The live preview for one reminder. It renders the IN-PROGRESS template through
 * the real backend renderer (`previewRotaMessage`), with this reminder's
 * `days_before`, so what the admin reads here is byte for byte what a member will
 * be texted, magic link included. An unknown placeholder comes back as
 * `validation_failed` and is shown right here rather than at save.
 */
export function MessagePreview({
  rotaId,
  memberId,
  recipientName,
  control,
  index,
}: {
  rotaId: number;
  memberId: number;
  recipientName: string;
  control: Control<RotaFormValues>;
  index: number;
}) {
  const template = useWatch({ control, name: `reminders.${index}.message_template` });
  const daysBefore = useWatch({ control, name: `reminders.${index}.days_before` });
  const [state, setState] = React.useState<PreviewState>({ status: "loading" });
  // An amount still being typed is NaN: keep showing the last preview until it is whole.
  const previewDaysBefore = Number.isInteger(daysBefore) ? daysBefore : null;

  React.useEffect(() => {
    if (previewDaysBefore === null) return;
    let active = true;
    const timer = setTimeout(async () => {
      setState({ status: "loading" });
      const result = await previewMessageAction(rotaId, {
        message_template: template,
        member_id: memberId,
        days_before: previewDaysBefore,
      });
      if (!active) return;

      if (result.ok) {
        setState({ status: "ok", text: result.data.preview });
      } else {
        setState({
          status: "error",
          message: apiErrorMessage(result.error, "Couldn't render a preview."),
        });
      }
    }, DEBOUNCE_MS);

    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [rotaId, template, memberId, previewDaysBefore]);

  return (
    <div className="bg-muted space-y-3 rounded-2xl p-4">
      <p className="text-sm font-medium">Live preview</p>
      {state.status === "loading" ? (
        <div className="space-y-2">
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-2/3" />
        </div>
      ) : null}

      {state.status === "error" ? (
        <Alert variant="warning">
          <AlertTitle>This message won&apos;t send as written</AlertTitle>
          <AlertDescription>{state.message}</AlertDescription>
        </Alert>
      ) : null}

      {state.status === "ok" ? (
        <>
          {/* A TEXT BUBBLE, not a code block: one squared-off corner is the
              whole cue, and it is what lands on a member's phone. */}
          <div className="bg-card rounded-2xl rounded-bl-sm p-3.5 text-sm whitespace-pre-wrap shadow-xs">
            {state.text}
          </div>
          <p className="text-xs text-muted-foreground">
            Exactly what {recipientName} would receive, magic link included.
          </p>
        </>
      ) : null}
    </div>
  );
}
