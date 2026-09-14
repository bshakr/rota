import { PauseCircle } from "lucide-react";

import { Container } from "@/components/container";
import { EmptyState } from "@/components/empty-state";
import { Wordmark } from "@/components/wordmark";
import { HOUSE_PAUSED_BODY, housePausedTitle } from "@/lib/hq-groups";

/**
 * What a paused house looks like from inside it.
 *
 * An operator can suspend a house (https://linear.app/bloombase/issue/BLO-1675).
 * Three surfaces then have to say so — the admin app, a housemate's own page, and
 * the household entry page — and they share this component so that an admin and
 * their housemates are told the same thing in the same words. The plan fixes the
 * copy: "This house is paused. Nothing is lost. Email us to pick it back up."
 *
 * IN THE HOUSE VOICE, not the operator's. The operator's word is "suspended",
 * which is administrative and sounds like a punishment; the house is told its
 * rota is resting. And the middle sentence is the one that matters most:
 * suspension is not a delete, nothing has been thrown away, and somebody arriving
 * here has to know that before they start again somewhere else.
 *
 * No error styling, no red, no code. Nothing has gone wrong from the reader's
 * point of view — a thing was switched off on purpose — so it wears the ordinary
 * empty-state panel with a peach coin, the same object every "nothing here yet"
 * in the product uses.
 *
 * There is deliberately no mailto. This product has no published support address
 * yet, and inventing one here would put an address on screen that bounces. The
 * sentence is the plan's, unchanged; when there is a real address to link, this
 * is the one place it goes.
 */
export function HousePaused({ name }: { name: string | null }) {
  return (
    <EmptyState icon={PauseCircle} title={housePausedTitle(name)} description={HOUSE_PAUSED_BODY} />
  );
}

/**
 * The admin app's whole paused screen, IN PLACE OF the shell rather than inside
 * it.
 *
 * No sidebar, no nav, nothing of the dashboard behind it: every one of those
 * links leads to a route Rails will refuse, and a navigation that always lands
 * back on the same notice teaches an admin that the app is broken rather than
 * that their house is resting. What is left is the wordmark, the sentence, and
 * `account` — the way out, so nobody is trapped here.
 *
 * A component rather than JSX inside the layout so that it can be rendered from a
 * fixture: this is a screen no screenshot could otherwise reach, because getting
 * a real one would mean suspending a real house behind a real WorkOS session.
 */
export function HousePausedScreen({
  name,
  account,
}: {
  name: string | null;
  account: React.ReactNode;
}) {
  return (
    <div className="flex min-h-full flex-1 flex-col">
      <Container asChild width="member">
        <header className="pt-7 pb-1">
          {/* Muted, like the member surface's: a signal that this is still Rota
              Monster, not a logo to admire on a screen nobody wanted to reach. */}
          <Wordmark muted />
        </header>
      </Container>
      <Container asChild width="member">
        <main className="flex-1 py-10 md:py-14">
          <HousePaused name={name} />
          {/* Under the notice rather than up in the chrome: the way out is the
              only control on this screen, and it should be the last thing read
              rather than the first thing offered. */}
          <div className="mt-8 flex justify-center">{account}</div>
        </main>
      </Container>
    </div>
  );
}

/**
 * The same fact, inline, for a surface that already has a card and a heading of
 * its own — the household entry page, where the house's name is the card's title
 * and a second panel inside it would say it twice.
 */
export function HousePausedNote() {
  return (
    <div className="bg-muted/60 flex items-start gap-3 rounded-2xl px-4 py-4">
      <PauseCircle className="text-muted-foreground mt-0.5 size-5 shrink-0" aria-hidden />
      <p className="text-sm text-pretty">
        <span className="font-medium">This house is paused.</span>{" "}
        <span className="text-muted-foreground">{HOUSE_PAUSED_BODY}</span>
      </p>
    </div>
  );
}
