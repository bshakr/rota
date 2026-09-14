import { describe, expect, it } from "vitest";

import { scrubBreadcrumb, scrubEvent, scrubString, scrubUrl } from "./scrub";

// The privacy contract, asserted. A scrubber without this test is the same as no
// scrubber the day somebody refactors it (docs/sentry-error-logging.md §3).
//
// The same four fixtures are asserted on the Rails side in
// apps/api/spec/lib/sentry_scrubber_spec.rb. The two files deliberately repeat the
// literals rather than share them: two languages, two SDKs, one contract.

/** A UK mobile in E.164, the shape Twilio quotes back in its own error messages. */
const PHONE = "+447700900123";
/** A magic link as it appears in a reminder text. */
const MAGIC_LINK = "https://rota.monster/s/9cRk3Qm2v8xYzT0bN4pL7wJdF6sH1aGe2Uy";
/** An Authorization header value, as it would reach a breadcrumb or a header map. */
const BEARER = "Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0In0.QWxpY2VJc0FuQWRtaW4";
/** A bare 32-byte URL-safe token: exactly the shape `Member#access_token` has. */
const BARE_TOKEN = "V1StGXR8Z5jdHi6B-myT_aBcDeFgHiJkLmNoPqRsTuV";

const FIXTURES = [PHONE, MAGIC_LINK, BEARER, BARE_TOKEN];

/** The tail of the magic link, which must not survive on its own either. */
const MAGIC_LINK_TOKEN = "9cRk3Qm2v8xYzT0bN4pL7wJdF6sH1aGe2Uy";

describe("scrubString", () => {
  it("rewrites an E.164 number", () => {
    expect(scrubString(`Twilio rejected ${PHONE}`)).toBe("Twilio rejected [phone]");
  });

  it("rewrites a magic link but keeps the route recognisable", () => {
    expect(scrubString(MAGIC_LINK)).toBe("https://rota.monster/s/[token]");
  });

  it("rewrites a bearer credential whatever it contains", () => {
    expect(scrubString(BEARER)).toBe("Bearer [filtered]");
    // Case-insensitive, and the replacement normalises the spelling.
    expect(scrubString("authorization: bearer abc.def.ghi")).toBe(
      "authorization: Bearer [filtered]",
    );
  });

  it("rewrites a bare 43-character token", () => {
    expect(scrubString(`token=${BARE_TOKEN} expired`)).toBe("token=[token] expired");
  });

  it("leaves a longer or shorter run of the same alphabet alone", () => {
    // The bare-token rule is length-exact on purpose: a commit SHA, a trace id and
    // a Twilio SID must stay readable or the events stop being useful.
    expect(scrubString("a".repeat(42))).toBe("a".repeat(42));
    expect(scrubString("a".repeat(44))).toBe("a".repeat(44));
    expect(scrubString("SM0123456789abcdef0123456789abcdef")).toBe(
      "SM0123456789abcdef0123456789abcdef",
    );
  });

  it("leaves ordinary prose untouched", () => {
    expect(scrubString("Alice is not responsible for this shift")).toBe(
      "Alice is not responsible for this shift",
    );
  });
});

describe("scrubUrl", () => {
  it("applies the same rules as scrubString", () => {
    expect(scrubUrl(`${MAGIC_LINK}?phone=${PHONE}`)).toBe(
      "https://rota.monster/s/[token]?phone=[phone]",
    );
  });
});

describe("scrubBreadcrumb", () => {
  it("rewrites the navigation URLs a member's browser records", () => {
    const crumb = scrubBreadcrumb({
      category: "navigation",
      message: `left ${MAGIC_LINK}`,
      data: { from: MAGIC_LINK, to: `${MAGIC_LINK}/cover`, url: MAGIC_LINK },
    });

    expect(JSON.stringify(crumb)).not.toContain(MAGIC_LINK_TOKEN);
    expect(crumb.data?.from).toBe("https://rota.monster/s/[token]");
  });
});

describe("scrubEvent", () => {
  it("deletes the request cookies and the credential headers outright", () => {
    const event = scrubEvent({
      request: {
        url: MAGIC_LINK,
        cookies: { "wos-session": "an-encrypted-authkit-session" },
        headers: {
          Authorization: BEARER,
          Cookie: "wos-session=an-encrypted-authkit-session",
          "user-agent": "Mozilla/5.0",
        },
      },
    });

    expect(event.request?.cookies).toBeUndefined();
    expect(event.request?.headers).toEqual({ "user-agent": "Mozilla/5.0" });
    expect(event.request?.url).toBe("https://rota.monster/s/[token]");
  });

  // The assertion that matters: a field the walker misses fails here rather than
  // leaking, because the whole serialised event is searched for every fixture.
  it("leaves none of the four fixtures anywhere in the serialised event", () => {
    const event = scrubEvent({
      event_id: "0123456789abcdef0123456789abcdef",
      message: `could not text ${PHONE}`,
      transaction: `GET /s/${MAGIC_LINK_TOKEN}`,
      exception: {
        values: [
          {
            type: "Error",
            value: `fetch ${MAGIC_LINK} failed with ${BEARER}`,
            stacktrace: { frames: [{ filename: `/app/s/${MAGIC_LINK_TOKEN}/page.tsx` }] },
          },
        ],
      },
      request: {
        url: `${MAGIC_LINK}?to=${PHONE}`,
        headers: { Authorization: BEARER, Cookie: `session=${BARE_TOKEN}` },
        cookies: { "wos-session": BARE_TOKEN },
      },
      breadcrumbs: [
        {
          category: "navigation",
          message: `navigated to ${MAGIC_LINK}`,
          data: { from: "/", to: MAGIC_LINK, url: MAGIC_LINK, note: BEARER },
        },
      ],
      tags: { household: "org_123", last_path: `/s/${MAGIC_LINK_TOKEN}` },
      extra: {
        smsBody: `Hi Alice, your shift: ${MAGIC_LINK}`,
        to: PHONE,
        nested: { deep: [{ token: BARE_TOKEN }] },
      },
      contexts: {
        member: { token: BARE_TOKEN, phone: PHONE },
        response: { headers: { authorization: BEARER } },
      },
    });

    const serialised = JSON.stringify(event);
    for (const fixture of FIXTURES) {
      expect(serialised).not.toContain(fixture);
    }
    expect(serialised).not.toContain(MAGIC_LINK_TOKEN);
    // Still a useful event: the shape of what happened survives the scrubbing.
    expect(serialised).toContain("[phone]");
    expect(serialised).toContain("/s/[token]");
    expect(serialised).toContain("Bearer [filtered]");
    expect(serialised).toContain("org_123");
  });

  it("survives a cyclic context rather than dropping the event", () => {
    const cyclic: Record<string, unknown> = { note: `ring ${PHONE}` };
    cyclic.self = cyclic;

    const event = scrubEvent({ contexts: { loop: cyclic } });

    expect(JSON.stringify(event.contexts?.loop?.note)).toContain("[phone]");
  });
});
