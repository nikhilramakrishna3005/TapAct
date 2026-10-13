import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  DUEL_ARCHETYPE_CATALOG,
  DUEL_TITLES,
  asPublicCharacter,
  characterPortraitSrc,
  characterSkipKey,
  clearCharacterSkipped,
  defaultCharacterDraft,
  hasSkippedCharacter,
  isMissingCharacterRpc,
  markCharacterSkipped,
  NEUTRAL_PORTRAIT_SRC,
} from "./character";

function memory() {
  const data = new Map<string, string>();
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => {
      data.set(key, value);
    },
    removeItem: (key: string) => {
      data.delete(key);
    },
  };
}

describe("duel character catalog", () => {
  it("keeps three original cosmetic archetypes with preset appearances", () => {
    expect(DUEL_ARCHETYPE_CATALOG.map((item) => item.id)).toEqual(["scholar", "warrior", "strategist"]);
    expect(DUEL_ARCHETYPE_CATALOG[0]?.energy).toBe("violet");
    expect(DUEL_ARCHETYPE_CATALOG[1]?.energy).toBe("teal");
    expect(DUEL_ARCHETYPE_CATALOG[2]?.energy).toBe("cyan");
    for (const archetype of DUEL_ARCHETYPE_CATALOG) {
      expect(archetype.appearances).toHaveLength(3);
      expect(archetype.description.length).toBeGreaterThan(20);
    }
    expect(DUEL_TITLES).toContain("Challenger");
  });

  it("accepts only catalog-backed public identities", () => {
    expect(asPublicCharacter({
      archetype: "scholar",
      appearance: "aurora",
      accent: "volt",
      title: "Focused",
    })).toEqual({
      archetype: "scholar",
      appearance: "aurora",
      accent: "volt",
      title: "Focused",
    });
    expect(asPublicCharacter({ archetype: "scholar", appearance: "surge", accent: "volt", title: "Focused" })).toBeNull();
    expect(asPublicCharacter({ archetype: "mage", appearance: "aurora", accent: "volt", title: "Focused" })).toBeNull();
    expect(asPublicCharacter({ archetype: "scholar", appearance: "aurora", accent: "gold", title: "Focused" })).toBeNull();
    expect(asPublicCharacter({ archetype: "scholar", appearance: "aurora", accent: "volt", title: "Champion" })).toBeNull();
    expect(asPublicCharacter({ email: "hidden@example.com", archetype: "scholar" })).toBeNull();
    expect(asPublicCharacter(null)).toBeNull();
  });

  it("maps portraits to local original assets and a neutral fallback", () => {
    expect(characterPortraitSrc(null)).toBe("/characters/neutral-placeholder.jpg");
    expect(characterPortraitSrc(defaultCharacterDraft("warrior"))).toBe("/characters/warrior-surge.jpg");
    expect(characterPortraitSrc({
      archetype: "strategist",
      appearance: "vault",
      accent: "cyan",
      title: "Pioneer",
    })).toBe("/characters/strategist-vault.jpg");
    const files = [
      NEUTRAL_PORTRAIT_SRC,
      ...DUEL_ARCHETYPE_CATALOG.flatMap((archetype) =>
        archetype.appearances.map((appearance) => `/characters/${archetype.id}-${appearance.id}.jpg`),
      ),
    ];
    for (const src of files) {
      expect(existsSync(resolve(process.cwd(), `public${src}`))).toBe(true);
    }
  });

  it("remembers a local skip without inventing a saved character", () => {
    const storage = memory();
    expect(hasSkippedCharacter(storage, "user-1")).toBe(false);
    expect(markCharacterSkipped(storage, "user-1")).toBe(true);
    expect(hasSkippedCharacter(storage, "user-1")).toBe(true);
    expect(hasSkippedCharacter(storage, "user-2")).toBe(false);
    expect(characterSkipKey("user-1")).toContain("user-1");
    clearCharacterSkipped(storage, "user-1");
    expect(hasSkippedCharacter(storage, "user-1")).toBe(false);
  });

  it("detects a missing character RPC so Duels still opens before the migration runs", () => {
    expect(isMissingCharacterRpc({ message: "Could not find the function public.tapact_get_duel_character" })).toBe(true);
    expect(isMissingCharacterRpc({ message: "You are not in this duel." })).toBe(false);
  });
});
