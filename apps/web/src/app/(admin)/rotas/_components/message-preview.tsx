"use client";

import * as React from "react";
import { type Control, useWatch } from "react-hook-form";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { apiErrorMessage } from "@/lib/api/errors";
import type { Member } from "@/lib/api/types";

import { previewMessageAction } from "../actions";
import type { RotaFormValues } from "./rota-details-form";

const DEBOUNCE_MS = 400;

type PreviewState =
  | { status: "loading" }
  | { status: "ok"; text: string; recipient: string }
  | { status: "error"; message: string };

/**
 * The live message preview. It renders the IN-PROGRESS template through the real
 * backend renderer (`previewRotaMessage`), so what the admin reads here is byte
 * for byte what a member will be texted — including the magic link the backend
 * appends. An unknown placeholder comes back as `validation_failed` and is shown
 * immediately, right here, rather than being discovered at save.
 */
export function MessagePreview({
  rotaId,
  members,
  control,
}: {
  rotaId: number;
  members: Member[];
  control: Control<RotaFormValues>;
}) {
  const template = useWatch({ control, name: "message_template" });
  const [memberId, setMemberId] = React.useState<number | undefined>(members[0]?.id);
  const [state, setState] = React.useState<PreviewState>({ status: "loading" });

  React.useEffect(() => {
    if (members.length === 0) return;

    let active = true;
    const timer = setTimeout(async () => {
      setState({ status: "loading" });
      const result = await previewMessageAction(rotaId, {
        message_template: template,
        member_id: memberId,
      });
      if (!active) return;

      if (result.ok) {
        setState({
          status: "ok",
          text: result.data.preview,
          recipient: result.data.member.name,
        });
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
  }, [rotaId, template, memberId, members.length]);

  if (members.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border px-4 py-3 text-sm text-muted-foreground">
        Add a member to your group to preview the message against a real recipient.
      </div>
    );
  }

  return (
    <div className="space-y-3 rounded-xl border border-border bg-muted/40 p-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm font-medium">Live preview</p>
        <div className="flex items-center gap-2">
          <Label htmlFor="preview-member" className="text-xs text-muted-foreground">
            As
          </Label>
          <Select
            value={memberId !== undefined ? String(memberId) : undefined}
            onValueChange={(value) => setMemberId(Number(value))}
          >
            <SelectTrigger id="preview-member" size="sm" className="w-40">
              <SelectValue placeholder="Pick a member" />
            </SelectTrigger>
            <SelectContent>
              {members.map((member) => (
                <SelectItem key={member.id} value={String(member.id)}>
                  {member.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

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
          <div className="rounded-lg border border-border bg-background p-3 text-sm whitespace-pre-wrap">
            {state.text}
          </div>
          <p className="text-xs text-muted-foreground">
            Exactly what {state.recipient} would receive, magic link included.
          </p>
        </>
      ) : null}
    </div>
  );
}
