"use client";

import * as React from "react";
import { Copy, MoreHorizontal, Pencil, Plus, RotateCw, UserMinus, Users } from "lucide-react";
import { toast } from "sonner";

import { toastApiError } from "@/lib/api/toast";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { initials, nameList } from "@/lib/format";

import { rotateMemberLinkAction } from "./actions";
import { type MemberRow, type MemberStatus, memberStatus } from "./data";
import { MemberFormDialog } from "./member-form-dialog";
import { RemoveMemberDialog } from "./remove-member-dialog";

// The one open dialog, if any. A single piece of state rather than four booleans
// so two dialogs can never both think they're open, and each carries the member
// it acts on.
type ActiveDialog =
  | { type: "none" }
  | { type: "add" }
  | { type: "edit"; member: MemberRow }
  | { type: "remove"; member: MemberRow }
  | { type: "rotate"; member: MemberRow };

function StatusBadge({ status }: { status: MemberStatus }) {
  switch (status) {
    case "inactive":
      // Removed. Kept in the list because their shift history is a record of who
      // was actually responsible; the badge says they take no new turns.
      return <Badge variant="outline">Inactive</Badge>;
    case "opted_out":
      // Active, but they texted STOP — reminders won't reach them. Exactly the
      // silently-missed-reminder this screen exists to surface, so it's a warning.
      return <Badge variant="warning">Opted out</Badge>;
    default:
      return <Badge variant="secondary">Active</Badge>;
  }
}

function RowActions({
  row,
  triggerSize,
  onEdit,
  onCopyLink,
  onRotate,
  onRemove,
}: {
  row: MemberRow;
  /** Table rows are mouse targets (small); a card on a phone is a 44px thumb target. */
  triggerSize: "icon-sm" | "icon-lg";
  onEdit: () => void;
  onCopyLink: () => void;
  onRotate: () => void;
  onRemove: () => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size={triggerSize} aria-label={`Actions for ${row.name}`}>
          <MoreHorizontal />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        <DropdownMenuItem onSelect={onEdit}>
          <Pencil /> Edit details
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={onCopyLink}>
          <Copy /> Copy magic link
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={onRotate}>
          <RotateCw /> Rotate magic link
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive" onSelect={onRemove}>
          <UserMinus /> Remove from house
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function MembersScreen({ members }: { members: MemberRow[] }) {
  const [dialog, setDialog] = React.useState<ActiveDialog>({ type: "none" });
  const close = () => setDialog({ type: "none" });

  async function copyMagicLink(row: MemberRow) {
    try {
      await navigator.clipboard.writeText(row.magicLinkUrl);
      toast.success("Magic link copied.", {
        description: `${row.name}'s personal link is on your clipboard.`,
      });
    } catch {
      toast.error("Couldn't copy to the clipboard.", {
        description: "Check the browser's clipboard permission and try again.",
      });
    }
  }

  // The action handlers shared by the desktop row and the mobile card.
  function actionsFor(row: MemberRow) {
    return {
      row,
      onEdit: () => setDialog({ type: "edit", member: row }),
      onCopyLink: () => void copyMagicLink(row),
      onRotate: () => setDialog({ type: "rotate", member: row }),
      onRemove: () => setDialog({ type: "remove", member: row }),
    };
  }

  const rotateTarget = dialog.type === "rotate" ? dialog.member : null;

  return (
    <>
      <PageHeader
        title="Members"
        description="Everyone who takes a turn. Add them once; they can appear in any rota."
        actions={
          <Button onClick={() => setDialog({ type: "add" })}>
            <Plus /> Add member
          </Button>
        }
      />

      {members.length === 0 ? (
        <EmptyState
          icon={Users}
          title="No members yet"
          description="Add the people who take turns. Once they're here, you can put them into any rota and the reminders take care of themselves."
          action={
            <Button onClick={() => setDialog({ type: "add" })}>
              <Plus /> Add your first member
            </Button>
          }
        />
      ) : (
        <>
          {/* md+ : the table */}
          <div className="border-border bg-card hidden overflow-hidden rounded-xl border md:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Phone</TableHead>
                  <TableHead>Rotas</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="w-0 text-right">
                    <span className="sr-only">Actions</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {members.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="font-medium">
                      <span className="flex items-center gap-2">
                        <Avatar className="size-6">
                          <AvatarFallback className="text-[10px]">{initials(row.name)}</AvatarFallback>
                        </Avatar>
                        {row.name}
                      </span>
                    </TableCell>
                    <TableCell className="text-muted-foreground tabular-nums">
                      {row.phone_e164}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {row.rotaNames.length ? nameList(row.rotaNames) : "—"}
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={memberStatus(row)} />
                    </TableCell>
                    <TableCell className="text-right">
                      {row.active ? <RowActions triggerSize="icon-sm" {...actionsFor(row)} /> : null}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          {/* below md : the same data as a card stack */}
          <div className="flex flex-col gap-3 md:hidden">
            {members.map((row) => (
              <Card key={row.id} size="sm">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-sm">
                    <Avatar className="size-6">
                      <AvatarFallback className="text-[10px]">{initials(row.name)}</AvatarFallback>
                    </Avatar>
                    {row.name}
                  </CardTitle>
                  <CardDescription className="tabular-nums">{row.phone_e164}</CardDescription>
                  <CardAction className="flex items-center gap-1">
                    <StatusBadge status={memberStatus(row)} />
                    {row.active ? <RowActions triggerSize="icon-lg" {...actionsFor(row)} /> : null}
                  </CardAction>
                </CardHeader>
                <CardContent className="text-muted-foreground">
                  {row.rotaNames.length ? `On ${nameList(row.rotaNames)}` : "Not on any rota yet"}
                </CardContent>
              </Card>
            ))}
          </div>
        </>
      )}

      {(dialog.type === "add" || dialog.type === "edit") && (
        <MemberFormDialog
          key={dialog.type === "edit" ? `edit-${dialog.member.id}` : "add"}
          member={dialog.type === "edit" ? dialog.member : undefined}
          onClose={close}
        />
      )}

      {dialog.type === "remove" && <RemoveMemberDialog member={dialog.member} onClose={close} />}

      {rotateTarget && (
        <ConfirmDialog
          open
          onOpenChange={(next) => {
            if (!next) close();
          }}
          title={`Rotate ${rotateTarget.name}'s magic link?`}
          description={
            <>
              This immediately kills {rotateTarget.name}&apos;s current link — including the one in
              any text already sent to them. Only do this if their phone was lost. Afterwards, copy
              the new link to share it again.
            </>
          }
          confirmLabel="Rotate link"
          onConfirm={async () => {
            // `.catch` handles the throw path (a non-ApiError like an unreachable
            // API) — toast and rethrow; the `!result.ok` branch below handles the
            // ApiError-as-value path. Either way ConfirmDialog stays open to retry.
            const result = await rotateMemberLinkAction(rotateTarget.id).catch((error) => {
              toastApiError(error, `Couldn't rotate ${rotateTarget.name}'s link.`);
              throw error;
            });
            if (!result.ok) {
              toastApiError(result.error, `Couldn't rotate ${rotateTarget.name}'s link.`);
              // Throw so ConfirmDialog keeps itself open for a retry.
              throw new Error("rotate failed");
            }
            toast.success(`New magic link generated for ${rotateTarget.name}.`, {
              description: "The old link no longer works. Copy the new one from their row to share it.",
            });
          }}
        />
      )}
    </>
  );
}
