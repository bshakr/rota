"use client";

import * as React from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

/**
 * The one confirmation dialog. It exists to fix a hierarchy that is easy to get
 * backwards — and did get backwards in this system's first reference dialog,
 * where "Remove Dave" was the pale button and "Keep him" was the solid one, so
 * the destructive action looked like the safe default.
 *
 * Here the shape is fixed and correct: the CONFIRM button is prominent and, when
 * `destructive`, solid red; CANCEL is the quiet secondary and is what a stray
 * Enter or a mis-tap lands on. "Removing Dave reassigns 2 shifts" is the kind of
 * consequence that must be stated before it happens, so `description` is where
 * the screen spells out exactly what will change.
 *
 * `onConfirm` may be async: the confirm button shows a spinner while it runs and
 * the dialog stays open until it resolves, then closes. A rejection leaves the
 * dialog open so the user can retry or cancel.
 */
export function ConfirmDialog({
  trigger,
  title,
  description,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  destructive = false,
  onConfirm,
  open: controlledOpen,
  onOpenChange,
}: {
  trigger?: React.ReactNode;
  title: string;
  description?: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  onConfirm: () => void | Promise<void>;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const [uncontrolledOpen, setUncontrolledOpen] = React.useState(false);
  const open = controlledOpen ?? uncontrolledOpen;
  const setOpen = onOpenChange ?? setUncontrolledOpen;
  const [pending, setPending] = React.useState(false);

  async function handleConfirm() {
    try {
      setPending(true);
      await onConfirm();
      setOpen(false);
    } catch (error) {
      // Leave the dialog open so the user can retry or cancel. The caller owns
      // telling them what failed (a toast); we only make sure a rejected
      // onConfirm doesn't surface as an unhandled promise rejection, since this
      // runs from an onClick React does not await.
      console.error(error);
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={pending ? undefined : setOpen}>
      {trigger ? <DialogTrigger asChild>{trigger}</DialogTrigger> : null}
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description ? (
            <DialogDescription>{description}</DialogDescription>
          ) : null}
        </DialogHeader>
        <DialogFooter>
          <Button
            variant="secondary"
            onClick={() => setOpen(false)}
            disabled={pending}
          >
            {cancelLabel}
          </Button>
          <Button
            variant={destructive ? "destructive" : "default"}
            onClick={handleConfirm}
            loading={pending}
          >
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
