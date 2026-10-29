import type { KnowledgeTemplateId } from "./types";
import { normalizeVaultFolder } from "./core/paths";
import { safeAiEndpoint } from "./core/security";

export interface EvidenceInboxSettings {
  captureFolder: string;
  mediaFolder: string;
  reportFolder: string;
  localizeImagesByDefault: boolean;
  defaultTemplate: KnowledgeTemplateId;
  maxBatchSize: number;
  aiEnabled: boolean;
  aiBaseUrl: string;
  aiModel: string;
  userContext: string;
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
  aiBaseUrl: "https://api.openai.com/v1",
  aiModel: "",
  userContext: "",
  hasSeenOnboarding: false
};

const TEMPLATES = new Set<KnowledgeTemplateId>(["raw", "research", "japan", "creator"]);

export function sanitizeAiBaseUrl(value: string): string {
  const endpoint = safeAiEndpoint(value.trim());
  return endpoint?.href.replace(/\/$/, "") ?? "";
}

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
    aiBaseUrl: typeof loaded.aiBaseUrl === "string"
      ? sanitizeAiBaseUrl(loaded.aiBaseUrl)
      : DEFAULT_SETTINGS.aiBaseUrl,
    aiModel: typeof loaded.aiModel === "string" ? loaded.aiModel.trim() : "",
    userContext: typeof loaded.userContext === "string" ? loaded.userContext.trim().slice(0, 4_000) : "",
    hasSeenOnboarding: booleanValue(loaded.hasSeenOnboarding, false)
  };
}

export function aiIsConfigured(settings: EvidenceInboxSettings, apiKey: string): boolean {
  return Boolean(settings.aiEnabled && apiKey && settings.aiBaseUrl && settings.aiModel);
}
