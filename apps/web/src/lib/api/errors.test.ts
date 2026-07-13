import { describe, expect, it } from "vitest";

import {
  ApiError,
  apiErrorMessage,
  buildApiError,
  isApiError,
} from "./errors";

describe("ApiError", () => {
  it("carries the Rails error code, status, and message", () => {
    const err = new ApiError(422, {
      error: "validation_failed",
      message: "Name can't be blank.",
      fields: { name: ["can't be blank"] },
    });

    expect(err).toBeInstanceOf(Error);
    expect(err.code).toBe("validation_failed");
    expect(err.status).toBe(422);
    expect(err.message).toBe("Name can't be blank.");
    expect(err.fields).toEqual({ name: ["can't be blank"] });
    expect(err.is("validation_failed")).toBe(true);
    expect(err.is("not_found")).toBe(false);
  });

  it("keeps the whole body so extras (warning, detail) survive", () => {
    const err = new ApiError(422, {
      error: "confirmation_required",
      message: "This schedule change regenerates future shifts.",
      warning: { deleted: 3, inserted: 4, dropped_covers: 1 },
    });

    expect(err.body.warning).toEqual({ deleted: 3, inserted: 4, dropped_covers: 1 });
  });

  it("round-trips through toBody() as a plain, serializable object", () => {
    const body = { error: "member_inactive", message: "Alice has been removed." };
    const err = new ApiError(422, body);
    expect(err.toBody()).toEqual(body);
    // A server action can return this across the RSC boundary; a class instance can't.
    expect(JSON.parse(JSON.stringify(err.toBody()))).toEqual(body);
  });

  it("is recognised by the isApiError guard", () => {
    expect(isApiError(new ApiError(404, { error: "not_found" }))).toBe(true);
    expect(isApiError(new Error("nope"))).toBe(false);
    expect(isApiError({ error: "not_found" })).toBe(false);
  });
});

describe("buildApiError", () => {
  it("uses a well-formed Rails error body verbatim", () => {
    const err = buildApiError(401, { error: "unauthorized" });
    expect(err.status).toBe(401);
    expect(err.code).toBe("unauthorized");
  });

  it("synthesises a code when the body is not the structured shape", () => {
    const err = buildApiError(500, "<html>Internal Server Error</html>");
    expect(err.status).toBe(500);
    expect(err.code).toBe("server_error");
  });

  it("synthesises a code for a missing body", () => {
    expect(buildApiError(502, null).code).toBe("server_error");
    expect(buildApiError(418, undefined).code).toBe("request_failed");
  });
});

describe("apiErrorMessage", () => {
  it("prefers the server's own message when present", () => {
    const err = new ApiError(422, { error: "validation_failed", message: "Name can't be blank." });
    expect(apiErrorMessage(err)).toBe("Name can't be blank.");
  });

  it("supplies friendly copy for bodiless codes (unauthorized, 429, 503)", () => {
    expect(apiErrorMessage(new ApiError(401, { error: "unauthorized" }))).toMatch(/sign in/i);
    expect(apiErrorMessage(new ApiError(429, { error: "too_many_requests" }))).toMatch(/too many/i);
    expect(apiErrorMessage(new ApiError(503, { error: "service_unavailable" }))).toMatch(/unavailable/i);
  });

  it("accepts a plain error body (as returned across a server action boundary)", () => {
    expect(apiErrorMessage({ error: "not_found", message: "Gone." })).toBe("Gone.");
  });

  it("falls back to the caller's fallback, then a generic message", () => {
    expect(apiErrorMessage(new Error("boom"), "Couldn't save the member.")).toBe(
      "Couldn't save the member.",
    );
    expect(apiErrorMessage(undefined)).toMatch(/something went wrong/i);
  });
});
