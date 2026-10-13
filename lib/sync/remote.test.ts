import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import { DEFAULT_ACTIVITIES } from "../tracker";
import { createSupabaseRemote, rowToActivity } from "./remote";

describe("supabase remote", () => {
  it("uploads activities without the category column when the server predates it", async () => {
    const calls: Record<string, unknown>[][] = [];
    const client = {
      from: () => ({
        upsert: async (rows: Record<string, unknown>[]) => {
          calls.push(rows);
          return "category" in rows[0]
            ? { error: { code: "PGRST204", message: "Could not find the 'category' column of 'tapact_activities'" }, status: 400 }
            : { error: null, status: 201 };
        },
      }),
    } as unknown as SupabaseClient;

    const activity = { ...DEFAULT_ACTIVITIES[0], category: "work" as const, updatedAtMs: 1, deviceId: "d" };
    await createSupabaseRemote(client).push("u", { activities: [activity], entries: [], baselines: [] });
    expect(calls).toHaveLength(2);
    expect(calls[0][0]).toMatchObject({ category: "work" });
    expect(calls[1][0]).not.toHaveProperty("category");
  });

  it("reads categories from rows and tells a missing column apart from Unassigned", () => {
    const row = { id: "a", name: "A", icon_key: "brain", color: "#8B95FF", goal_minutes: null, cue: "", archived_at_ms: null, client_updated_at_ms: 1, updated_by_device: "d" };
    expect(rowToActivity({ ...row, category: "rest" })?.category).toBe("rest");
    expect(rowToActivity({ ...row, category: null })?.category).toBeNull();
    expect(rowToActivity(row)?.category).toBeUndefined();
  });
});
