import { safeAiEndpoint } from "../core/security";
import {
  defaultModel,
  getProvider,
  migrateKey,
  resolveProvider,
  slotFromEndpoint,
  type AiSlot,
  type KeyStore
} from "../vendor/rex-ai-kit/index";

/** The AI slot the plugin stores. Never holds the key, only the Keychain name. */
export type AiServiceSlot = AiSlot & { grantExpiry?: string | undefined };

/** What a new install, or one that never set up AI, starts with. */
export const DEFAULT_AI: AiServiceSlot = { provider: "openai", model: "gpt-6-luna" };

/** The Keychain name 0.1.0 to 0.3.x kept the key under. Still read when it holds a key. */
export const LEGACY_SECRET_NAME = "evidence-inbox-ai-key";

/** The address the old settings started with; on its own it does not mean AI was set up. */
const LEGACY_DEFAULT_URL = "https://api.openai.com/v1";

/** AI fields before the shared AI service, read only here. `aiApiKey` was never written by a release; read defensively. */
interface LegacyAi {
  aiBaseUrl?: unknown;
  aiModel?: unknown;
  aiApiKey?: unknown;
}

const LEGACY_FIELDS: (keyof LegacyAi)[] = ["aiBaseUrl", "aiModel", "aiApiKey"];

type Store = Required<Pick<KeyStore, "getSecret" | "setSecret">>;

/** A saved slot as stored, or null when it is missing or malformed. */
export function readSlot(value: unknown): AiServiceSlot | null {
  if (value === null || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  if (typeof raw.provider !== "string" || !raw.provider.trim()) return null;
  const text = (key: string): string | undefined => {
    const value = raw[key];
    return typeof value === "string" && value.trim() ? value.trim() : undefined;
  };
  const slot: AiServiceSlot = { provider: raw.provider.trim(), model: typeof raw.model === "string" ? raw.model.trim() : "" };
  const secretName = text("secretName");
  const baseUrl = text("baseUrl");
  const grantExpiry = text("grantExpiry");
  if (secretName) slot.secretName = secretName;
  if (baseUrl) slot.baseUrl = baseUrl;
  if (grantExpiry) slot.grantExpiry = grantExpiry;
  return slot;
}

/**
 * The saved AI setup as one slot, plus whether data.json must be saved again.
 *
 * - Already migrated (`ai` present): kept as is.
 * - Never set up (no model, no key, the stock address): the new default.
 * - Otherwise the provider comes from the old address and the old Keychain name is kept, so nothing has to be re-entered.
 * - A key still in plain text moves into the Keychain and is removed from the data.
 * - A plugin-only Keychain name that holds nothing, while the shared name does, is dropped.
 */
export function migrateAiSettings(saved: unknown, store: Store): { ai: AiServiceSlot; changed: boolean } {
  const raw = saved !== null && typeof saved === "object" ? saved as Record<string, unknown> & LegacyAi : {};
  const hasLegacy = LEGACY_FIELDS.some((field) => field in raw);
  const current = readSlot(raw.ai);
  const plainKey = typeof raw.aiApiKey === "string" ? raw.aiApiKey.trim() : "";

  let ai: AiServiceSlot;
  if (current) {
    ai = current;
  } else {
    const url = typeof raw.aiBaseUrl === "string" ? cleanUrl(raw.aiBaseUrl) : "";
    const model = typeof raw.aiModel === "string" ? raw.aiModel.trim() : "";
    const storedKey = read(store, LEGACY_SECRET_NAME);
    const untouched = !model && !storedKey && !plainKey && (!url || url === LEGACY_DEFAULT_URL);
    ai = untouched
      ? { ...DEFAULT_AI }
      : withModel(slotFromEndpoint({ url, model, secretName: LEGACY_SECRET_NAME }));
  }

  let changed = hasLegacy || (!current && Object.keys(raw).length > 0);
  if (plainKey) {
    moveKey(ai, plainKey, store);
    changed = true;
  }
  if (preferReadableKey(ai, store)) changed = true;
  return { ai, changed };
}

/** Old address with credentials, query and fragment removed; unsafe addresses (plain HTTP off this computer) give "". */
function cleanUrl(value: string): string {
  return safeAiEndpoint(value.trim())?.href.replace(/\/$/, "") ?? "";
}

/** An empty model meant "not chosen yet"; start on the provider's cheap pick. */
function withModel(slot: AiServiceSlot): AiServiceSlot {
  if (!slot.model) {
    const provider = getProvider(slot.provider);
    if (provider) slot.model = defaultModel(provider, "cheap");
  }
  return slot;
}

/**
 * Stores a plain-text key under the shared name (or a name of this plugin's own when another plugin
 * keeps a different key there). The slot points at it unless its Keychain name already holds a key.
 */
function moveKey(ai: AiServiceSlot, plainKey: string, store: Store): void {
  const shared = resolveProvider({ provider: ai.provider }).secretName;
  if (!shared) return;
  const name = migrateKey(store, shared, plainKey, "evidence-inbox");
  if (ai.secretName && read(store, ai.secretName) && ai.secretName !== name) return;
  if (name === shared) delete ai.secretName;
  else ai.secretName = name;
}

/** A saved Keychain name that holds nothing, while the shared name does, is dropped so the shared key is used. */
export function preferReadableKey(ai: AiServiceSlot, store: Pick<KeyStore, "getSecret">): boolean {
  const shared = resolveProvider({ provider: ai.provider }).secretName;
  if (!ai.secretName || !shared || read(store, ai.secretName) || !read(store, shared)) return false;
  delete ai.secretName;
  return true;
}

function read(store: Pick<KeyStore, "getSecret">, name: string): string {
  try {
    return store.getSecret(name)?.trim() ?? "";
  } catch {
    return "";
  }
}
