import { beforeEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

const mocks = vi.hoisted(() => ({ auth: vi.fn(), read: vi.fn(), openai: vi.fn() }));
vi.mock("@/lib/auth/require-auth", () => ({ requireAuth: mocks.auth, UnauthorizedError: class extends Error {} }));
vi.mock("@/lib/db/activity", () => ({ getObjectUpdates: mocks.read }));
vi.mock("@/lib/ai/openai", () => ({ getOpenAIClient: mocks.openai }));
import { GET } from "@/app/api/objects/[objectId]/activity/route";
import { UnauthorizedError } from "@/lib/auth/require-auth";
import { ActivityContent } from "@/components/activity/ActivityLog";
import { activityLabel } from "@/lib/activity/types";

const row = { id: "event", objectId: "object-a", type: "ai_replan", content: "Saved summary", createdAt: "2026-09-09T10:00:00.000Z" };
function get(objectId = "object-a") {
  return GET(new Request(`http://localhost/api/objects/${objectId}/activity`), { params: Promise.resolve({ objectId }) });
}
beforeEach(() => { vi.resetAllMocks(); mocks.auth.mockResolvedValue({}); mocks.read.mockResolvedValue([row]); });

describe("Activity GET boundary", () => {
  it("rejects unauthenticated access before reading any private data", async () => {
    mocks.auth.mockRejectedValue(new UnauthorizedError());
    const response = await get();
    expect(response.status).toBe(401);
    expect(mocks.read).not.toHaveBeenCalled();
    expect(mocks.openai).not.toHaveBeenCalled();
    expect(await response.text()).not.toContain("Saved summary");
  });
  it("validates IDs before DB work", async () => {
    expect((await get("bad id")).status).toBe(400);
    expect(mocks.read).not.toHaveBeenCalled();
  });
  it("returns persisted rows with no-store and no OpenAI call", async () => {
    const response = await get();
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ updates: [row] });
    expect(mocks.read).toHaveBeenCalledExactlyOnceWith("object-a");
    expect(mocks.openai).not.toHaveBeenCalled();
  });
  it("distinguishes nonexistent objects from an empty history", async () => {
    mocks.read.mockResolvedValueOnce(null);
    expect((await get()).status).toBe(404);
    mocks.read.mockResolvedValueOnce([]);
    expect(await (await get()).json()).toEqual({ updates: [] });
  });
  it("returns a safe recoverable error without SQL details", async () => {
    mocks.read.mockRejectedValue(new Error("private database details"));
    const response = await get();
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: { code: "DATABASE_ERROR", message: "Could not load activity." } });
    expect(mocks.openai).not.toHaveBeenCalled();
  });
});

describe("Activity presentation", () => {
  it.each(["future_event", "toString", "__proto__"])("safely renders unknown event %s", (type) => {
    expect(activityLabel(type)).toBe("Activity");
    const html = renderToStaticMarkup(createElement(ActivityContent, { state: { status: "ready", updates: [{ ...row, type, content: "<script>bad</script>" }] }, onRetry: vi.fn() }));
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("<script>");
    expect(html).toContain('dateTime="2026-09-09T10:00:00.000Z"');
    expect(mocks.openai).not.toHaveBeenCalled();
  });
  it("shows loading, empty, and retry states locally", () => {
    for (const [state, message] of [
      [{ status: "loading" } as const, "Loading activity"],
      [{ status: "ready", updates: [] } as const, "No activity yet."],
      [{ status: "error" } as const, "Could not load activity."],
    ] as const) {
      const html = renderToStaticMarkup(createElement(ActivityContent, { state: state.status === "ready" ? { status: "ready", updates: [] } : state, onRetry: vi.fn() }));
      expect(html).toContain(message);
      if (state.status === "error") expect(html).toContain("Retry");
    }
  });
  it("distinguishes manual events from stored AI summaries", () => {
    expect(activityLabel("object_edited")).toBe("Object edited");
    expect(activityLabel("ai_progress_update")).toBe("AI Progress Update");
    expect(activityLabel("ai_replan")).toBe("AI Replan");
  });
});
