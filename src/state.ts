export type Section = "translate" | "overlay" | "history" | "assistant" | "browser" | "guide";
export const LANGUAGES = [{ code: "sk", name: "Словацкий", textLabel: "Текст на словацком" }, { code: "ru", name: "Русский", textLabel: "Текст на русском" }, { code: "en", name: "Английский", textLabel: "Текст на английском" }] as const;
export type Language = typeof LANGUAGES[number]["code"];
// Order matches the Rust session snapshot; the first two preserve old sessions.
export const DIRECTIONS = ["sk-ru", "ru-sk", "en-ru", "ru-en", "en-sk", "sk-en", "auto-ru", "auto-sk", "auto-en"] as const;
export type Direction = typeof DIRECTIONS[number];
export interface Drafts { incoming: string; outgoing: string; enRu: string; ruEn: string; enSk: string; skEn: string; autoRu: string; autoSk: string; autoEn: string; question: string; game: string; }
export const DRAFT_KEY = "ari-overlay:drafts:v1";
export const EMPTY_DRAFTS: Drafts = { incoming: "", outgoing: "", enRu: "", ruEn: "", enSk: "", skEn: "", autoRu: "", autoSk: "", autoEn: "", question: "", game: "Minecraft" };
const LIMIT = 12_000;

// Stored data can be old or malformed. Never assume localStorage has our shape.
export function restoreDrafts(raw: string | null): Drafts {
  if (!raw) return { ...EMPTY_DRAFTS };
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== "object" || Array.isArray(value)) return { ...EMPTY_DRAFTS };
    const input = value as Record<string, unknown>;
    const read = (key: keyof Drafts) => typeof input[key] === "string" ? (input[key] as string).slice(0, LIMIT) : EMPTY_DRAFTS[key];
    return { incoming: read("incoming"), outgoing: read("outgoing"), enRu: read("enRu"), ruEn: read("ruEn"), enSk: read("enSk"), skEn: read("skEn"), autoRu: read("autoRu"), autoSk: read("autoSk"), autoEn: read("autoEn"), question: read("question"), game: read("game") };
  } catch { return { ...EMPTY_DRAFTS }; }
}

export function draftKey(direction: Direction): keyof Drafts {
  return ({ "sk-ru": "incoming", "ru-sk": "outgoing", "en-ru": "enRu", "ru-en": "ruEn", "en-sk": "enSk", "sk-en": "skEn", "auto-ru": "autoRu", "auto-sk": "autoSk", "auto-en": "autoEn" } as const)[direction];
}

export function languagePair(direction: Direction): [Language | "auto", Language] { return direction.split("-") as [Language | "auto", Language]; }
export function selectLanguage(direction: Direction, side: "source" | "target", language: string): Direction {
  if (!(side === "source" && language === "auto") && !LANGUAGES.some(item => item.code === language)) return direction;
  const [source, target] = languagePair(direction);
  if (side === "source" && language === "auto") return `auto-${target}`;
  const selected = language as Language;
  if (side === "target" && source === "auto") return `auto-${selected}`;
  const previousSource = source === "auto" ? (target === "ru" ? "sk" : "ru") : source;
  const pair = side === "source" ? [selected, selected === target ? previousSource : target] : [selected === source ? target : source, selected];
  const next = `${pair[0]}-${pair[1]}`;
  return DIRECTIONS.find(item => item === next) ?? direction;
}

export function mergeDraftChange(stored: Drafts, edited: Drafts, key: keyof Drafts): Drafts {
  return { ...stored, [key]: edited[key] };
}

export function parseSection(value: string | undefined): Section | null {
  return value === "translate" || value === "overlay" || value === "history" || value === "assistant" || value === "browser" || value === "guide" ? value : null;
}
