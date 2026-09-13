import Link from "next/link";

import { Container } from "@/components/container";
import { ThemeToggle } from "@/components/theme-toggle";
import { Wordmark } from "@/components/wordmark";

import { SiteFooter } from "./site-footer";

/**
 * The shell and the typography for the privacy and terms pages.
 *
 * There is no prose plugin in this project and no other long-form page to copy,
 * so the scale is set once here rather than twice in two route files: one
 * measure, one heading size, one paragraph size, one list style. Both documents
 * are meant to be read straight through, so nothing is folded away and nothing
 * is in a card.
 *
 * Header, document and footer all take `Container width="prose"`, so the
 * wordmark sits on the same left edge as the first sentence under it. The
 * header is the landing page's own minus the sign-in button: a visitor who came
 * here from the footer wants the way back, not another call to action.
 */
export function LegalPage({
  title,
  updated,
  children,
}: {
  title: string;
  updated: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-full flex-1 flex-col">
      <Container asChild width="prose">
        <header className="flex items-center justify-between py-5">
          <Link
            href="/"
            prefetch={false}
            className="focus-visible:outline-ring rounded-sm focus-visible:outline-2 focus-visible:outline-offset-2"
          >
            <Wordmark />
          </Link>
          <ThemeToggle />
        </header>
      </Container>

      <Container asChild width="prose">
        <main className="flex-1 pt-6 pb-16 md:pt-10 md:pb-24">
          <h1 className="font-heading text-3xl font-semibold text-balance md:text-4xl">
            {title}
          </h1>
          <p className="mt-3 text-sm text-muted-foreground">Last updated: {updated}</p>
          {children}
        </main>
      </Container>

      <SiteFooter width="prose" />
    </div>
  );
}

/** A named part of the document. Its heading is the only h2 inside it. */
export function Section({ heading, children }: { heading: string; children: React.ReactNode }) {
  return (
    <section className="mt-10">
      <h2 className="font-heading text-xl font-semibold text-balance md:text-2xl">{heading}</h2>
      {children}
    </section>
  );
}

/**
 * A paragraph of the document.
 *
 * `md:text-lg` rather than plain `text-base`: the prose measure is 42rem, which
 * at 16px runs past 80 characters a line on a desktop. Setting the type a step
 * larger pulls the line back into the readable range and costs nothing on a
 * phone, where the measure was already fine. No `text-pretty` here either: over
 * a full page of text its orphan avoidance leaves a visible staircase in the
 * right-hand rag.
 */
export function P({ children }: { children: React.ReactNode }) {
  return <p className="mt-3 text-base text-muted-foreground md:text-lg">{children}</p>;
}

/**
 * A list inside a section. Discs, because Tailwind's reset strips markers and a
 * list of what is stored about a person should look like a list.
 */
export function Bullets({ items }: { items: readonly string[] }) {
  return (
    <ul className="mt-3 list-disc space-y-1.5 pl-5 text-base text-muted-foreground md:text-lg">
      {items.map((item) => (
        <li key={item}>{item}</li>
      ))}
    </ul>
  );
}

/**
 * An address or a web address written into the prose.
 *
 * A privacy page that says "write to this address" and then renders it as dead
 * text is asking the reader to retype it. `href` is passed rather than derived
 * so the same component covers both a mailbox and the ICO.
 */
export function InlineLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a
      href={href}
      className="focus-visible:outline-ring rounded-sm text-link underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2"
    >
      {children}
    </a>
  );
}

/** The contact mailbox, as a link, wherever the prose names it. */
export function MailLink({ address }: { address: string }) {
  return <InlineLink href={`mailto:${address}`}>{address}</InlineLink>;
}
