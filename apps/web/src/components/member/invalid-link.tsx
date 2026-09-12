import { Link2Off } from "lucide-react";

import { EmptyState } from "@/components/empty-state";

/**
 * What the member page shows when the magic-link token doesn't resolve: a
 * rotated link (an admin reset it after a lost phone), a mistyped URL, or a
 * link that was never valid. BLO-1055 renders this instead of the shift list
 * when the token lookup returns nothing.
 *
 * It gives no hint about WHY the token failed and never confirms whether a token
 * exists: enumeration is a real risk on a permanent, guessable-length
 * credential (see the failure-modes section of the spec). The tone stays warm
 * and blameless, which is the whole point of the Soft Clay voice here. The
 * person holding a dead link did nothing wrong, they are probably standing in a
 * kitchen, and their way out is a human ("ask whoever runs your rota"), because
 * there is no login on this surface to send them to.
 */
export function InvalidLink() {
  return (
    <EmptyState
      icon={Link2Off}
      title="This link has stopped working"
      description="Links get swapped for newer ones now and then. Ask whoever runs your rota to text you a fresh one and you'll be straight back in."
    />
  );
}
