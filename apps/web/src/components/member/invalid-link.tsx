import { LinkIcon } from "lucide-react";

import { EmptyState } from "@/components/empty-state";

/**
 * What the member page shows when the magic-link token doesn't resolve — a
 * rotated link (an admin reset it after a lost phone), a mistyped URL, or a
 * link that was never valid. BLO-1055 renders this instead of the shift list
 * when the token lookup returns nothing.
 *
 * It gives no hint about WHY the token failed and never confirms whether a token
 * exists — enumeration is a real risk on a permanent, guessable-length
 * credential (see the failure-modes section of the spec). The tone stays warm
 * and blameless: the person holding a dead link did nothing wrong, and their way
 * out is a human ("ask whoever runs your rota"), because there is no login here
 * to send them to.
 */
export function InvalidLink() {
  return (
    <EmptyState
      icon={LinkIcon}
      title="This link isn't working"
      description="It may have been replaced with a newer one. Ask whoever runs your rota to text you a fresh link."
    />
  );
}
