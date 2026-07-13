import { describe, expect, it } from "vitest";

import type { Member, Rota } from "@/lib/api/types";

import { buildMagicLink, memberStatus, rotaNamesByMemberId, toMemberRows } from "./data";

function rota(partial: Partial<Rota> & Pick<Rota, "id" | "name">): Rota {
  return {
    message_template: "It's your turn, {{name}}.",
    starts_on: "2026-07-01",
    interval_count: 1,
    interval_unit: "week",
    send_hour: 9,
    reminder_offsets: [0],
    active: true,
    draft: false,
    positions: [],
    ...partial,
  };
}

function member(partial: Partial<Member> & Pick<Member, "id" | "name">): Member {
  return {
    phone_e164: "+447700900123",
    active: true,
    contactable: true,
    sms_opted_out_at: null,
    access_token: "tok-default",
    ...partial,
  };
}

describe("rotaNamesByMemberId", () => {
  it("groups the rotas each member is positioned in, in rota order", () => {
    const rotas = [
      rota({
        id: 1,
        name: "Kitchen",
        positions: [
          { member_id: 10, name: "Alice", position: 0 },
          { member_id: 20, name: "Bob", position: 1 },
        ],
      }),
      rota({
        id: 2,
        name: "Bins",
        positions: [{ member_id: 10, name: "Alice", position: 0 }],
      }),
    ];

    const map = rotaNamesByMemberId(rotas);

    expect(map.get(10)).toEqual(["Kitchen", "Bins"]);
    expect(map.get(20)).toEqual(["Kitchen"]);
    expect(map.get(30)).toBeUndefined();
  });

  it("excludes retired (inactive) rotas — 'appears in' means the live rosters", () => {
    const rotas = [
      rota({ id: 1, name: "Kitchen", positions: [{ member_id: 10, name: "Alice", position: 0 }] }),
      rota({
        id: 2,
        name: "Old bathroom rota",
        active: false,
        positions: [{ member_id: 10, name: "Alice", position: 0 }],
      }),
    ];

    expect(rotaNamesByMemberId(rotas).get(10)).toEqual(["Kitchen"]);
  });
});

describe("buildMagicLink", () => {
  it("joins the app origin and the member's token at /s/", () => {
    expect(buildMagicLink("https://rota.example", "x7Kd2p")).toBe("https://rota.example/s/x7Kd2p");
  });

  it("tolerates a trailing slash on the configured origin", () => {
    expect(buildMagicLink("http://localhost:3001/", "abc")).toBe("http://localhost:3001/s/abc");
  });
});

describe("memberStatus", () => {
  it("is inactive once removed, whatever the contactable flag says", () => {
    expect(memberStatus({ active: false, contactable: false })).toBe("inactive");
  });

  it("is opted_out when active but not contactable", () => {
    expect(memberStatus({ active: true, contactable: false })).toBe("opted_out");
  });

  it("is active when active and contactable", () => {
    expect(memberStatus({ active: true, contactable: true })).toBe("active");
  });
});

describe("toMemberRows", () => {
  it("carries each member plus its rota names and a ready-to-copy magic link", () => {
    const members = [
      member({ id: 10, name: "Alice", access_token: "alice-tok" }),
      member({ id: 30, name: "Zoe", access_token: "zoe-tok" }),
    ];
    const rotas = [
      rota({ id: 1, name: "Kitchen", positions: [{ member_id: 10, name: "Alice", position: 0 }] }),
    ];

    const rows = toMemberRows(members, rotas, "https://rota.example");

    expect(rows[0]).toMatchObject({
      id: 10,
      name: "Alice",
      rotaNames: ["Kitchen"],
      magicLinkUrl: "https://rota.example/s/alice-tok",
    });
    // A member on no rota gets an empty list, never undefined.
    expect(rows[1].rotaNames).toEqual([]);
    expect(rows[1].magicLinkUrl).toBe("https://rota.example/s/zoe-tok");
  });

  it("preserves the API's name ordering of members", () => {
    const rows = toMemberRows(
      [member({ id: 2, name: "Bob" }), member({ id: 1, name: "Alice" })],
      [],
      "https://rota.example",
    );
    expect(rows.map((r) => r.name)).toEqual(["Bob", "Alice"]);
  });
});
