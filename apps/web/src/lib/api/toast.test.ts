import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

import { toast } from "sonner";

import { ApiError } from "./errors";
import { toastApiError } from "./toast";

const errorToast = toast.error as unknown as ReturnType<typeof vi.fn>;

describe("toastApiError", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("surfaces the server's message and returns it", () => {
    const shown = toastApiError(
      new ApiError(422, { error: "validation_failed", message: "Name can't be blank." }),
    );
    expect(shown).toBe("Name can't be blank.");
    expect(errorToast).toHaveBeenCalledWith("Name can't be blank.");
  });

  it("maps a bodiless code to friendly copy", () => {
    const shown = toastApiError(new ApiError(429, { error: "too_many_requests" }));
    expect(shown).toMatch(/too many/i);
    expect(errorToast).toHaveBeenCalledWith(shown);
  });

  it("falls back to the caller's message for a non-API error", () => {
    toastApiError(new Error("network down"), "Couldn't save the member.");
    expect(errorToast).toHaveBeenCalledWith("Couldn't save the member.");
  });
});
