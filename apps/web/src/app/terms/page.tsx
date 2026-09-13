import type { Metadata } from "next";

import { Bullets, LegalPage, MailLink, P, Section } from "@/app/_components/legal-page";
import { CONTACT_EMAIL } from "@/lib/site";

// The layout's template turns this into "Terms · Rota Monster".
export const metadata: Metadata = {
  title: "Terms",
  description:
    "The terms for using Rota Monster: free to use, run by one person, no warranty, England and Wales.",
};

/**
 * The terms page. Short on purpose. This is a free product run by one person for
 * households, and a five thousand word agreement written for a company that does
 * not exist would be less honest than a page somebody reads to the end.
 *
 * No company name and no company number appear anywhere, because there is
 * neither. "The operator" is the individual who runs it.
 */
export default function TermsPage() {
  return (
    <LegalPage title="Terms" updated="13 September 2026">
      <P>
        These are the terms for using Rota Monster. They are between you and the operator,
        the individual in the UK who runs it. Using Rota Monster means accepting them. They
        are short because the product is small and free, not because anything is hidden.
      </P>

      <Section heading="What Rota Monster does">
        <P>
          It keeps a house rota and sends whoever is next a text with a link to their own
          page. If the house connects a calendar, it reads event titles and dates so that a
          turn is less likely to land on somebody who is away. That is the whole product.
        </P>
      </Section>

      <Section heading="It is free">
        <P>
          Rota Monster is free to use today, and the operator pays for the text messages.
          There is no plan to bill you without telling you first. If that ever changes, you
          will be told before it does.
        </P>
      </Section>

      <Section heading="Your house is yours to run">
        <P>
          Whoever sets a house up is its admin, and the admin decides who is in it. By
          adding somebody, you are saying you have their agreement to give their name and
          mobile number to Rota Monster and to have it text them. Keep that number correct,
          and remove people once they have moved out.
        </P>
        <P>
          Housemates&rsquo; private links and the house calendar link are secrets. Anybody
          holding one of them can see what it opens, so pass them on carefully.
        </P>
      </Section>

      <Section heading="What you must not do">
        <Bullets
          items={[
            "Add anybody’s mobile number without their agreement.",
            "Use the reminders to harass anyone, or to send marketing or anything unlawful.",
            "Try to reach another house’s data, work around sign-in, or take the service apart automatically.",
            "Put anything into a house name, chore or message that you would not want a housemate to read.",
          ]}
        />
      </Section>

      <Section heading="It can break">
        <P>
          Rota Monster is provided as it is, with no warranty of any kind. It is one person
          and modest hosting. Texts can be late, can fail, or can be blocked by a network.
          Calendars can be out of date. The service can be down without notice, and no
          uptime is promised. Please do not depend on it for anything that matters more than
          the washing up.
        </P>
      </Section>

      <Section heading="Liability">
        <P>
          So far as the law allows, the operator is not liable for any loss or inconvenience
          arising from using Rota Monster, including a reminder that did not arrive, a turn
          that landed on the wrong person, or a chore nobody did. Nothing in these terms
          limits liability for death or personal injury caused by negligence, for fraud, or
          for anything else that cannot be limited by law. Nothing here affects the
          statutory rights of a consumer in the UK.
        </P>
      </Section>

      <Section heading="Ending it">
        <P>
          Stop using Rota Monster whenever you like, and write to <MailLink address={CONTACT_EMAIL} /> to
          have your house deleted. The operator may suspend or remove a house that breaks these
          terms, and may close the service entirely, giving what notice is reasonably
          possible.
        </P>
      </Section>

      <Section heading="Changes">
        <P>
          These terms can change. When they do, the date at the top changes with them, and
          carrying on using Rota Monster is how you accept the new version.
        </P>
      </Section>

      <Section heading="Governing law">
        <P>
          These terms are governed by the law of England and Wales, and the courts of
          England and Wales have jurisdiction over any dispute about them.
        </P>
      </Section>

      <Section heading="Contact">
        <P>
          Anything at all: <MailLink address={CONTACT_EMAIL} />.
        </P>
      </Section>
    </LegalPage>
  );
}
