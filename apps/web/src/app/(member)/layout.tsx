import { Container } from "@/components/container";
import { Wordmark } from "@/components/wordmark";

/**
 * The member surface. Opened on a phone, from a text message, by someone who
 * did not ask to be here and is not logged in.
 *
 * There is no navigation, no theme toggle and no account menu — not because
 * they were forgotten, but because a member has exactly one thing to do and
 * every extra control is one more thing to ignore. The theme follows the
 * phone's own setting. Single column, comfortable measure, thumb-reachable.
 */
export default function MemberLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <div className="flex min-h-full flex-1 flex-col">
      <Container width="member" asChild>
        <header className="pt-7 pb-1">
          {/* Muted: a signal that the link is genuine, not a logo to admire. */}
          <Wordmark muted />
        </header>
      </Container>
      <Container width="member" asChild>
        <main className="flex-1 pt-4 pb-16">{children}</main>
      </Container>
    </div>
  );
}
