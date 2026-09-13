import Link from "next/link";

import { Container } from "@/components/container";
import { Wordmark } from "@/components/wordmark";
import { CONTACT_EMAIL, MAKER_NAME, MAKER_URL, SITE_TAGLINE } from "@/lib/site";

/** The focus ring every footer link shares. */
const FOCUS =
  "focus-visible:outline-ring rounded-sm focus-visible:outline-2 focus-visible:outline-offset-2";

/**
 * One link vocabulary for the whole footer: underlined at rest, not on hover.
 *
 * The maker credit is muted rather than grape, so it needs a non-colour
 * affordance to read as a link at all. Underlining only it would leave the
 * credit carrying more decoration than Privacy and Terms sitting just above,
 * which is backwards for a footer whose job is those two links. So they all
 * take the same underline.
 */
const LINK = `${FOCUS} underline underline-offset-4`;

/**
 * The public footer, shared by the landing page and the two legal pages.
 *
 * It carries what a visitor looks down here for: who made this, how to reach
 * them, and where the privacy and terms live. The tagline comes from
 * `SITE_TAGLINE` rather than a literal, so the footer and the hero paragraph
 * cannot drift apart. `prefetch={false}` throughout, matching the rest of the
 * public shell: these are pages somebody chooses to open, not routes worth
 * fetching on every homepage view.
 *
 * `width` follows the measure of the page above it. The landing page is
 * `admin` (max-w-5xl) like its own header; a legal page is `prose`, so the
 * wordmark, the document and the footer all sit on one left edge instead of
 * three. A hairline above it, because on a legal page the document simply stops
 * and the footer needs a line to sit under.
 */
export function SiteFooter({ width = "admin" }: { width?: "admin" | "prose" }) {
  return (
    <Container asChild width={width}>
      <footer className="pb-10">
        <div className="flex flex-col gap-6 border-t border-border pt-8 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex flex-col gap-1.5">
            <Link
              href="/"
              prefetch={false}
              aria-label="Rota Monster home"
              className={`w-fit ${FOCUS} underline-offset-4 hover:underline`}
            >
              <Wordmark muted />
            </Link>
            <p className="text-xs text-muted-foreground">{SITE_TAGLINE}</p>
          </div>

          {/* Wider gap on a phone, where the credit sits directly under the
              three-link row and would otherwise scan as a wrapped fourth item. */}
          <div className="flex flex-col gap-5 sm:gap-2.5 sm:items-end">
            <nav className="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm text-link">
              <Link href="/privacy" prefetch={false} className={LINK}>
                Privacy
              </Link>
              <Link href="/terms" prefetch={false} className={LINK}>
                Terms
              </Link>
              <a href={`mailto:${CONTACT_EMAIL}`} className={LINK}>
                Contact
              </a>
            </nav>
            {/* Quiet by colour rather than by decoration: the muted token, so it
                does not read as a fourth item in the row above. A plain <a>
                because it leaves the site. */}
            <a
              href={MAKER_URL}
              rel="noopener"
              className={`text-sm text-muted-foreground hover:text-link ${LINK}`}
            >
              Made by {MAKER_NAME}
            </a>
          </div>
        </div>
      </footer>
    </Container>
  );
}
