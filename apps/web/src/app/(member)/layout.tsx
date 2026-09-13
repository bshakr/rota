import { Container } from "@/components/container";
import { Wordmark } from "@/components/wordmark";

/**
 * The member surface. Opened on a phone, from a text message, by someone who
 * did not ask to be here and is not logged in.
 *
 * There is no navigation, no theme toggle and no account menu — not because
 * they were forgotten, but because a member has exactly one thing to do and
 * every extra control is one more thing to ignore. The theme follows the
 * phone's own setting. One column on a phone. From 1024px the same page
 * becomes a feed with a sidebar, so the gutter widens with it; below that
 * nothing changes.
 *
 * In SOFT CLAY the chrome is deliberately almost nothing: lavender paper, the
 * wordmark in muted type, and then white clay cards. The page's one piece of
 * personality is the greeting and the peach date coins below it, and they only
 * land because there is nothing else competing for the eye.
 */
export default function MemberLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <div className="flex min-h-full flex-1 flex-col">
      <Container width="feed" asChild>
        <header className="pt-7 pb-1">
          {/* Muted: a signal that the link is genuine, not a logo to admire. */}
          <Wordmark muted />
        </header>
      </Container>
      <Container width="feed" asChild>
        {/* Deep bottom padding: the last card's CTA must clear the phone's own
            home indicator and browser chrome, not sit under them. */}
        <main className="flex-1 pt-4 pb-20">{children}</main>
      </Container>
    </div>
  );
}
