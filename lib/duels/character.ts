export const DUEL_ARCHETYPES = ["scholar", "warrior", "strategist"] as const;
export type DuelArchetypeId = (typeof DUEL_ARCHETYPES)[number];

export const DUEL_ACCENTS = ["volt", "teal", "cyan", "ember", "mint"] as const;
export type DuelAccentId = (typeof DUEL_ACCENTS)[number];

export const DUEL_TITLES = ["Challenger", "Focused", "Consistent", "Rival", "Contender", "Pioneer"] as const;
export type DuelTitle = (typeof DUEL_TITLES)[number];

export type DuelCharacterPublic = {
  archetype: DuelArchetypeId;
  appearance: string;
  accent: DuelAccentId;
  title: DuelTitle;
};

export type DuelAppearance = {
  id: string;
  name: string;
};

export type DuelArchetype = {
  id: DuelArchetypeId;
  name: string;
  energy: string;
  description: string;
  defaultAccent: DuelAccentId;
  appearances: readonly DuelAppearance[];
};

export type DuelAccent = {
  id: DuelAccentId;
  name: string;
  hex: string;
};

/** Generated original TapAct portraits. Graphite studio backgrounds; not final transparent production art. */
export const CHARACTER_ART_STATUS = "generated-concept" as const;

export const DUEL_ARCHETYPE_CATALOG: readonly DuelArchetype[] = [
  {
    id: "scholar",
    name: "Scholar",
    energy: "violet",
    description: "Elegant futuristic attire. Calm, precise, and built for long focus.",
    defaultAccent: "volt",
    appearances: [
      { id: "aurora", name: "Aurora" },
      { id: "dusk", name: "Dusk" },
      { id: "prism", name: "Prism" },
    ],
  },
  {
    id: "warrior",
    name: "Warrior",
    energy: "teal",
    description: "Athletic futuristic armor. Fast, resilient, and made for daily battles.",
    defaultAccent: "teal",
    appearances: [
      { id: "surge", name: "Surge" },
      { id: "forge", name: "Forge" },
      { id: "tide", name: "Tide" },
    ],
  },
  {
    id: "strategist",
    name: "Strategist",
    energy: "cyan",
    description: "Sleek tactical attire. Cool, calculated, and ready for the long game.",
    defaultAccent: "cyan",
    appearances: [
      { id: "pulse", name: "Pulse" },
      { id: "vault", name: "Vault" },
      { id: "signal", name: "Signal" },
    ],
  },
];

export const DUEL_ACCENT_CATALOG: readonly DuelAccent[] = [
  { id: "volt", name: "Violet", hex: "#8E7BFF" },
  { id: "teal", name: "Teal", hex: "#2EE6C6" },
  { id: "cyan", name: "Cyan", hex: "#5FE3FF" },
  { id: "ember", name: "Ember", hex: "#FFB86B" },
  { id: "mint", name: "Mint", hex: "#6CF2C2" },
];

export const NEUTRAL_PORTRAIT_SRC = "/characters/neutral-placeholder.jpg";

const SKIP_KEY = "tapact.duelCharacter.skipped";

type StorageLike = {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
  removeItem: (key: string) => void;
};

export function archetypeOf(id: string | null | undefined): DuelArchetype | null {
  return DUEL_ARCHETYPE_CATALOG.find((item) => item.id === id) ?? null;
}

export function appearanceOf(archetype: DuelArchetype, id: string | null | undefined): DuelAppearance | null {
  return archetype.appearances.find((item) => item.id === id) ?? null;
}

export function accentOf(id: string | null | undefined): DuelAccent | null {
  return DUEL_ACCENT_CATALOG.find((item) => item.id === id) ?? null;
}

export function defaultCharacterDraft(archetypeId: DuelArchetypeId = "scholar"): DuelCharacterPublic {
  const archetype = archetypeOf(archetypeId) ?? DUEL_ARCHETYPE_CATALOG[0];
  return {
    archetype: archetype.id,
    appearance: archetype.appearances[0].id,
    accent: archetype.defaultAccent,
    title: "Challenger",
  };
}

export function asPublicCharacter(raw: unknown): DuelCharacterPublic | null {
  if (!raw || typeof raw !== "object") return null;
  const value = raw as Record<string, unknown>;
  const archetype = archetypeOf(typeof value.archetype === "string" ? value.archetype : null);
  const appearance = archetype ? appearanceOf(archetype, typeof value.appearance === "string" ? value.appearance : null) : null;
  const accent = accentOf(typeof value.accent === "string" ? value.accent : null);
  const title = typeof value.title === "string" && (DUEL_TITLES as readonly string[]).includes(value.title)
    ? (value.title as DuelTitle)
    : null;
  if (!archetype || !appearance || !accent || !title) return null;
  return {
    archetype: archetype.id,
    appearance: appearance.id,
    accent: accent.id,
    title,
  };
}

export function characterPortraitSrc(character: DuelCharacterPublic | null): string {
  if (!character) return NEUTRAL_PORTRAIT_SRC;
  return `/characters/${character.archetype}-${character.appearance}.jpg`;
}

export function characterLabel(character: DuelCharacterPublic | null): string {
  if (!character) return "Neutral challenger";
  const archetype = archetypeOf(character.archetype);
  const appearance = archetype ? appearanceOf(archetype, character.appearance) : null;
  return [archetype?.name, appearance?.name, character.title].filter(Boolean).join(" · ");
}

export function characterSkipKey(userId: string): string {
  return `${SKIP_KEY}.${userId}`;
}

export function hasSkippedCharacter(storage: StorageLike | null, userId: string): boolean {
  if (!storage || !userId) return false;
  try {
    return storage.getItem(characterSkipKey(userId)) === "1";
  } catch {
    return false;
  }
}

export function markCharacterSkipped(storage: StorageLike | null, userId: string): boolean {
  if (!storage || !userId) return false;
  try {
    storage.setItem(characterSkipKey(userId), "1");
    return true;
  } catch {
    return false;
  }
}

export function clearCharacterSkipped(storage: StorageLike | null, userId: string): void {
  if (!storage || !userId) return;
  try {
    storage.removeItem(characterSkipKey(userId));
  } catch {
    return;
  }
}

export function isMissingCharacterRpc(error: unknown): boolean {
  const message = error && typeof error === "object" && "message" in error ? String((error as { message: unknown }).message) : "";
  return /could not find the function|schema cache|does not exist|tapact_get_duel_character|tapact_set_duel_character/i.test(message);
}
