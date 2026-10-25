export type KnowledgeTemplateId = "raw" | "research" | "japan" | "creator";

export type CaptureState = "complete" | "partial";
export type MediaState = "complete" | "partial" | "skipped";
export type AiState = "complete" | "failed" | "disabled" | "not_requested";

export interface RemoteImage {
  remoteUrl: string;
  localPath?: string;
  downloadError?: string;
}

export interface EvidenceSource {
  platform: "xiaohongshu";
  sourceId: string;
  canonicalUrl: string;
  title: string;
  author: string;
  body: string;
  tags: string[];
  publishedAt?: string;
  sourceKind: "image" | "video" | "unknown";
  images: RemoteImage[];
  capturedAt: string;
  warnings: string[];
  extractionMethod: "initial_state" | "open_graph";
}

export interface KnowledgeClaim {
  claim: string;
  evidence: string;
}

export interface TemplateField {
  key: string;
  label: string;
  value: string;
}

export interface KnowledgeCard {
  template: Exclude<KnowledgeTemplateId, "raw">;
  insight: string;
  claims: KnowledgeClaim[];
  verificationNeeded: string[];
  relevance: string;
  connections: string[];
  nextAction: string;
  templateFields: TemplateField[];
}

export interface PreviewSuccess {
  kind: "success";
  inputUrl: string;
  source: EvidenceSource;
  plannedPath: string;
  duplicatePath?: string;
  duplicateManaged?: boolean;
  batchDuplicate?: boolean;
}

export interface PreviewFailure {
  kind: "failure";
  inputUrl: string;
  displayUrl: string;
  reason: string;
  recovery: string;
}

export type PreviewItem = PreviewSuccess | PreviewFailure;

export type ImportOutcome = "created" | "updated" | "skipped" | "partial" | "failed";

export interface ImportResult {
  outcome: ImportOutcome;
  sourceId?: string;
  title: string;
  displayUrl: string;
  path?: string;
  reason?: string;
  warnings: string[];
}

export interface ImportOptions {
  template: KnowledgeTemplateId;
  localizeImages: boolean;
  generateWithAi: boolean;
}

export interface WriteNoteInput {
  source: EvidenceSource;
  knowledgeCard?: KnowledgeCard;
  template: KnowledgeTemplateId;
  captureState: CaptureState;
  mediaState: MediaState;
  aiState: AiState;
  aiError?: string;
  preserveKnowledgeCard?: boolean;
  preserveMediaState?: boolean;
}
