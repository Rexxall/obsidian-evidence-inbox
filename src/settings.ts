import type { KnowledgeTemplateId } from "./types";
import { normalizeVaultFolder } from "./core/paths";
import { DEFAULT_AI, readSlot, type AiServiceSlot } from "./ai/migrate";
import type { AiClient, ModelCacheData } from "./vendor/rex-ai-kit/index";

export interface EvidenceInboxSettings {
  captureFolder: string;
  mediaFolder: string;
  reportFolder: string;
  localizeImagesByDefault: boolean;
  defaultTemplate: KnowledgeTemplateId;
  maxBatchSize: number;
  aiEnabled: boolean;
  /** Provider, model and Keychain name of the AI service. The key itself stays in the Keychain. */
  ai: AiServiceSlot;
  /** Model lists fetched by Check or Refresh, so opening the settings needs no request. */
  modelCache?: ModelCacheData;
  userContext: string;
  /** Added to the cssclasses of the notes and reports the plugin writes. Empty adds none. */
  noteCssClass: string;
  /** The import progress count in Didot italic: the plugin's one signature detail. */
  serifNumbers: boolean;
  hasSeenOnboarding: boolean;
}

export const DEFAULT_SETTINGS: EvidenceInboxSettings = {
  captureFolder: "Evidence Inbox/小红书",
  mediaFolder: "Evidence Inbox/Assets",
  reportFolder: "Evidence Inbox/Reports",
  localizeImagesByDefault: true,
  defaultTemplate: "creator",
  maxBatchSize: 10,
  aiEnabled: false,
  ai: { ...DEFAULT_AI },
  userContext: "",
  noteCssClass: "",
  serifNumbers: true,
  hasSeenOnboarding: false
};

const TEMPLATES = new Set<KnowledgeTemplateId>(["raw", "research", "japan", "creator"]);

export function normalizeSettings(value: unknown, configDir?: string): EvidenceInboxSettings {
  const loaded = value !== null && typeof value === "object" ? value as Partial<EvidenceInboxSettings> : {};
  const stringValue = (candidate: unknown): string => typeof candidate === "string" ? candidate : "";
  const booleanValue = (candidate: unknown, fallback: boolean): boolean => typeof candidate === "boolean" ? candidate : fallback;
  const maxBatch = Number.isFinite(loaded.maxBatchSize)
    ? Math.max(1, Math.min(10, Math.floor(loaded.maxBatchSize!)))
    : DEFAULT_SETTINGS.maxBatchSize;
  return {
    captureFolder: normalizeVaultFolder(stringValue(loaded.captureFolder), DEFAULT_SETTINGS.captureFolder, configDir),
    mediaFolder: normalizeVaultFolder(stringValue(loaded.mediaFolder), DEFAULT_SETTINGS.mediaFolder, configDir),
    reportFolder: normalizeVaultFolder(stringValue(loaded.reportFolder), DEFAULT_SETTINGS.reportFolder, configDir),
    localizeImagesByDefault: booleanValue(loaded.localizeImagesByDefault, DEFAULT_SETTINGS.localizeImagesByDefault),
    defaultTemplate: TEMPLATES.has(loaded.defaultTemplate as KnowledgeTemplateId)
      ? loaded.defaultTemplate as KnowledgeTemplateId
      : DEFAULT_SETTINGS.defaultTemplate,
    maxBatchSize: maxBatch,
    aiEnabled: booleanValue(loaded.aiEnabled, DEFAULT_SETTINGS.aiEnabled),
    // Old address, model and key fields are dropped here; main.ts turns them into `ai` with migrateAiSettings.
    ai: readSlot(loaded.ai) ?? { ...DEFAULT_AI },
    ...(isModelCache(loaded.modelCache) ? { modelCache: loaded.modelCache } : {}),
    userContext: typeof loaded.userContext === "string" ? loaded.userContext.trim().slice(0, 4_000) : "",
    noteCssClass: typeof loaded.noteCssClass === "string" ? loaded.noteCssClass.trim() : "",
    serifNumbers: loaded.serifNumbers !== false,
    hasSeenOnboarding: booleanValue(loaded.hasSeenOnboarding, false)
  };
}

function isModelCache(value: unknown): value is ModelCacheData {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** AI is switched on, the service has a key (or needs none), an address and a model. */
export function aiIsConfigured(settings: EvidenceInboxSettings, ai: Pick<AiClient, "hasKey" | "provider"> | null | undefined): boolean {
  if (!settings.aiEnabled || !ai) return false;
  const provider = ai.provider(settings.ai);
  if (provider.localAgent) return true;
  return Boolean(provider.baseUrl && settings.ai.model.trim() && ai.hasKey(settings.ai));
}
