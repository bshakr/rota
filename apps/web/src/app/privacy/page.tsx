import type { Metadata } from "next";

import {
  Bullets,
  InlineLink,
  LegalPage,
  MailLink,
  P,
  Section,
} from "@/app/_components/legal-page";
import { CONTACT_EMAIL } from "@/lib/site";

// The layout's template turns this into "Privacy · Rota Monster".
export const metadata: Metadata = {
  title: "Privacy",
  description:
    "What Rota Monster stores about a house and its housemates, who else sees it, and how to have it deleted.",
};

/**
 * The privacy page. Written to be read by a housemate who has just had their
 * number added by somebody else, which is the position most people meet this
 * product from.
 *
 * Every claim here is a claim about what the code does today. Where the code
 * does nothing, the page says so rather than borrowing a reassuring sentence
 * from a template: there is no retention schedule, there is no self-serve
 * delete, and the secrets are not encrypted by the application. Those sentences
 * become untrue the day the behaviour changes, which is the point of writing
 * them down.
 */
export default function PrivacyPage() {
  return (
    <LegalPage title="Privacy" updated="14 September 2026">
      <P>
        Rota Monster is a chore rota that sends a housemate a text when it is their turn.
        It is run by one person in the UK, called the operator throughout this page. What
        follows is what Rota Monster stores, who else sees it, and what you can ask for.
      </P>

      <Section heading="Who is responsible">
        <P>
          Rota Monster is not a company. It is run and paid for by an individual in the UK,
          who is the data controller for everything described here. Writing to <MailLink address={CONTACT_EMAIL} /> reaches them.
        </P>
      </Section>

      <Section heading="What is stored">
        <P>
          The person who sets a house up is the admin. Everybody else in the house is a
          housemate. About the admin, Rota Monster stores:
        </P>
        <Bullets
          items={[
            "Their name and email address, which come from the sign-in provider.",
            "Which house they look after.",
          ]}
        />
        <P>About each housemate:</P>
        <Bullets
          items={[
            "Their name.",
            "Their mobile number.",
            "A private token, which is what the link in their text points to.",
            "Their turns, and any turn they have handed on to somebody else.",
          ]}
        />
        <P>About the house:</P>
        <Bullets
          items={[
            "The house name, its web address and its time zone.",
            "The chores, who takes turns at them, and when the reminders go out.",
            "Every reminder sent, including the wording of the message, whether the network accepted it, and when.",
          ]}
        />
        <P>If the house connects a calendar, Rota Monster also stores:</P>
        <Bullets
          items={[
            "The calendar’s secret link.",
            "For events from a week ago to ninety days ahead: the title, the dates and times, whether it runs all day, and the calendar’s own identifier for it.",
            "Whether Rota Monster read that title as somebody being away, and a one-line reason.",
          ]}
        />
        <P>
          Event descriptions, guest lists and locations are never read out of the calendar,
          so they are never stored. There is no advertising and no profiling. Nothing here
          is sold, and nothing is shared for marketing.
        </P>
      </Section>

      <Section heading="Counting visits">
        <P>
          Rota Monster keeps a count of how many visits the site gets and how many get
          through each step of setting a house up. The counts are kept cookie-free and only
          as totals, so they can say how many visits there were and never who made one.
          About each visit, Rota Monster records the following and nothing else:
        </P>
        <Bullets
          items={[
            "Which page was opened.",
            "Which site linked to it, if any. The site’s address only, never the page on it and never anything after the question mark.",
            "The campaign labels on the link that brought them, when the link carried any.",
            "The country, when the network in front of the site reports one. It often does not.",
            "Whether it was a phone, a tablet or a computer.",
          ]}
        />
        <P>
          What is never recorded: an IP address, the long identifying string a browser sends
          about itself, a cookie, or a visitor or session number of any kind. There is
          nothing in a count to join two of them together with, so Rota Monster cannot tell
          one visit from another, cannot tell a returning visitor from a new one, and cannot
          build a picture of anybody. These counts are deleted after 180 days.
        </P>
      </Section>

      <Section heading="Why it is held">
        <Bullets
          items={[
            "To text the right housemate at the right time.",
            "To give each housemate a page showing their own turns.",
            "To keep a turn from landing on somebody who is away.",
            "To let the admin see whether a reminder arrived.",
          ]}
        />
        <P>
          The lawful basis is legitimate interests. A house has asked for a rota, and a rota
          cannot run without names, numbers and turns. The admin is responsible for telling
          the people they add that their number is in Rota Monster. If you would rather not
          be in it, ask your admin to remove you, or write to the operator.
        </P>
      </Section>

      <Section heading="Who else sees it">
        <P>Three companies handle part of this on Rota Monster&rsquo;s behalf. Nobody else does.</P>
        <Bullets
          items={[
            "Twilio sends the text messages. It receives the housemate’s mobile number and the message, which contains their name and their private link.",
            "WorkOS handles admin sign-in. It holds the admin’s email address and their sign-in history. Housemates never sign in, so WorkOS never sees them.",
            "Anthropic’s Claude reads calendar event titles, so that a trip can be told apart from a dinner. Each request sends event titles, their dates, and the names of the housemates, so a title like “Ciara in France” can be matched to a person. It does not send phone numbers, email addresses, the calendar link, or anything from the calendar beyond titles and dates.",
          ]}
        />
        <P>
          Rota Monster runs on Railway, a managed hosting platform, and its database runs
          there too. Railway, Twilio, WorkOS and Anthropic are United States companies and
          may handle this data outside the UK. Those transfers rely on the standard
          contractual terms each of them publishes for UK and European personal data.
        </P>
      </Section>

      <Section heading="How long it is kept">
        <P>
          Rota Monster keeps what a house gives it for as long as the house is using it. The
          visit counts above are the only thing deleted on a timer, and they go after 180
          days. Nothing else is, and this page will say so plainly until something is.
        </P>
        <Bullets
          items={[
            "Disconnecting the house calendar deletes the stored link and every event that came from it, at once.",
            "Removing a housemate stops their private link working straight away. Their name and number stay on the house record, so past turns still make sense.",
            "Reminder records, including the wording that was sent, are kept so the admin can look back at what arrived.",
          ]}
        />
        <P>
          There is no button that deletes a whole house yet. Ask the operator and the house,
          its housemates, its rota and its reminder records are deleted.
        </P>
      </Section>

      <Section heading="Keeping the secrets secret">
        <P>
          A housemate&rsquo;s private link and the house calendar link are both secrets:
          anybody holding one can see what it opens. The calendar link is never shown in
          full again once it is saved, and it is kept out of logs and error reports. Neither
          secret is encrypted by Rota Monster separately from the database it sits in, so
          both are as safe as that database and the one person with access to it.
        </P>
      </Section>

      <Section heading="Cookies">
        <P>
          Rota Monster sets no advertising cookies, and nothing here follows anybody between
          sites. The visit counting described above sets no cookie of its own: it stores
          nothing about who is visiting, so it has nothing to remember them by. Admin
          sign-in sets an encrypted session cookie and a short-lived one used only while
          signing in. A housemate opening their link from a text gets no cookie at all.
          Whether you chose light or dark is kept in your own browser and never sent
          anywhere.
        </P>
        <P>
          One more cookie is set, and only for somebody who arrives with a campaign link.
          It holds the campaign labels from that link for up to thirty days so that, if
          they go on to set a house up, the house can record what brought them. It carries
          no identifier, it is never used to recognise anybody, and it is deleted the moment
          the house is made.
        </P>
      </Section>

      <Section heading="Your rights">
        <P>
          Under UK data protection law you can ask for a copy of what is held about you, ask
          for it to be corrected or deleted, ask for its use to be restricted, object to its
          use, or ask for it in a portable form. Write to <MailLink address={CONTACT_EMAIL} /> and you
          will have an answer within one month.
        </P>
        <P>
          If that answer does not satisfy you, you can complain to the Information
          Commissioner&rsquo;s Office at{" "}
          <InlineLink href="https://ico.org.uk">ico.org.uk</InlineLink>.
        </P>
      </Section>

      <Section heading="Children">
        <P>
          Rota Monster is meant for adults sharing a house. It is not aimed at children and
          does not knowingly hold data about anybody under 13.
        </P>
      </Section>

      <Section heading="Changes">
        <P>
          If this page changes, the date at the top changes with it. Questions go to{" "}
          <MailLink address={CONTACT_EMAIL} />.
        </P>
      </Section>
    </LegalPage>
  );
}
