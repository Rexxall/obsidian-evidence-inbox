import type { App } from "obsidian";
import type {
  AiState,
  EvidenceSource,
  ImportOptions,
  ImportResult,
  MediaState,
  PreviewItem,
  PreviewSuccess
} from "../types";
import type { EvidenceInboxSettings } from "../settings";
import { aiIsConfigured } from "../settings";
import { createPlaceholderCard } from "../core/knowledge-templates";
import { sanitizeDiagnostic, stripUrlSecrets } from "../core/security";
import { UnsupportedXhsPageError } from "../core/xhs-parser";
import { AiKnowledgeClient } from "../network/ai-client";
import type { HttpGateway } from "../network/http";
import { MediaDownloader, reuseExistingMedia } from "../network/media-downloader";
import { XhsPublicClient } from "../network/xhs-client";
import { EvidenceVaultWriter } from "../vault/vault-writer";

export interface BatchImportResult {
  results: ImportResult[];
  reportPath?: string;
}

export interface BatchProgress {
  completed: number;
  total: number;
  label: string;
}

async function mapWithConcurrency<T, R>(
  values: T[],
  concurrency: number,
  mapper: (value: T, index: number) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(values.length);
  let nextIndex = 0;
  async function worker(): Promise<void> {
    while (nextIndex < values.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await mapper(values[index]!, index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, values.length) }, () => worker()));
  return results;
}

function recoveryFor(error: unknown): string {
  if (error instanceof UnsupportedXhsPageError) return "确认它是公开笔记而不是主页/专辑，并在浏览器中检查链接仍可打开。";
  const message = sanitizeDiagnostic(error).toLowerCase();
  if (message.includes("http 403") || message.includes("http 429")) return "稍后重试；插件不会尝试绕过平台限制。";
  if (message.includes("超时") || message.includes("network")) return "检查网络后重试该条链接。";
  return "打开原链接确认公开可见；若仍失败，请保留错误说明用于兼容性修复。";
}

function cloneSource(source: EvidenceSource): EvidenceSource {
  return { ...source, tags: [...source.tags], images: source.images.map((image) => ({ ...image })), warnings: [...source.warnings] };
}

export class EvidenceImportService {
  /** Pause between two page requests, so a batch reads like a person opening links one after another. */
  static pageGapMs = 1_200;

  private readonly publicClient: XhsPublicClient;
  private readonly aiClient: AiKnowledgeClient;
  private readonly writer: EvidenceVaultWriter;

  constructor(
    private readonly app: App,
    private readonly settings: EvidenceInboxSettings,
    private readonly http: HttpGateway,
    private readonly aiApiKey = "",
    private readonly signal?: AbortSignal
  ) {
    this.publicClient = new XhsPublicClient(http, signal);
    this.aiClient = new AiKnowledgeClient(http, signal);
    this.writer = new EvidenceVaultWriter(app, settings);
  }

  private pause(ms: number): Promise<void> {
    if (ms <= 0 || this.signal?.aborted) return Promise.resolve();
    return new Promise((resolve) => {
      const timer = window.setTimeout(done, ms);
      const signal = this.signal;
      function done(): void {
        window.clearTimeout(timer);
        signal?.removeEventListener("abort", done);
        resolve();
      }
      signal?.addEventListener("abort", done, { once: true });
    });
  }

  private assertActive(): void {
    if (this.signal?.aborted) throw new Error("操作已取消。");
  }

  async preview(
    urls: string[],
    onProgress?: (progress: BatchProgress) => void
  ): Promise<PreviewItem[]> {
    let completed = 0;
    const previews = await mapWithConcurrency(urls, 1, async (inputUrl, index): Promise<PreviewItem> => {
      if (index > 0) await this.pause(EvidenceImportService.pageGapMs);
      this.assertActive();
      try {
        const source = await this.publicClient.fetchPublicNote(inputUrl);
        const existing = await this.writer.inspectSource(source.sourceId);
        return {
          kind: "success",
          inputUrl,
          source,
          plannedPath: existing?.file.path ?? await this.writer.plannedPath(source.title, source.sourceId),
          ...(existing ? { duplicatePath: existing.file.path, duplicateManaged: existing.managed } : {})
        };
      } catch (error) {
        this.assertActive();
        return {
          kind: "failure",
          inputUrl,
          displayUrl: stripUrlSecrets(inputUrl),
          reason: sanitizeDiagnostic(error),
          recovery: recoveryFor(error)
        };
      } finally {
        completed += 1;
        onProgress?.({ completed, total: urls.length, label: "正在读取公开页面" });
      }
    });
    const seen = new Set<string>();
    return previews.map((preview) => {
      if (preview.kind === "failure") return preview;
      if (seen.has(preview.source.sourceId)) return { ...preview, batchDuplicate: true };
      seen.add(preview.source.sourceId);
      return preview;
    });
  }

  private async importOne(preview: PreviewSuccess, options: ImportOptions): Promise<ImportResult> {
    this.assertActive();
    const source = cloneSource(preview.source);
    if (preview.batchDuplicate) {
      return {
        outcome: "skipped",
        sourceId: source.sourceId,
        title: source.title,
        displayUrl: source.canonicalUrl,
        reason: "本批已有相同来源，已跳过重复项。",
        warnings: []
      };
    }
    const existing = await this.writer.inspectSource(source.sourceId);
    if (existing && !existing.managed) {
      return {
        outcome: "skipped",
        sourceId: source.sourceId,
        title: source.title,
        displayUrl: source.canonicalUrl,
        path: existing.file.path,
        reason: "已有同源笔记但没有 Evidence Inbox 管理标记；未发起图片或 AI 请求，也未修改文件。",
        warnings: []
      };
    }
    const preserveKnowledgeCard = Boolean(existing?.managed);
    let preserveMediaState = false;
    let mediaState: MediaState = "skipped";
    if (options.localizeImages && source.images.length > 0) {
      try {
        source.images = await new MediaDownloader(this.app, this.http, this.settings.mediaFolder, this.signal)
          .localize(source.sourceId, source.images);
      } catch (error) {
        this.assertActive();
        const reason = `图片本地化失败：${sanitizeDiagnostic(error)}`;
        source.images = source.images.map((image) => ({ ...image, downloadError: reason }));
      }
      mediaState = source.images.some((image) => image.downloadError) ? "partial" : "complete";
    } else if (existing?.managed && !options.localizeImages && source.images.length > 0) {
      const reused = await reuseExistingMedia(this.app, this.settings.mediaFolder, source.sourceId, source.images);
      source.images = reused.images;
      preserveMediaState = reused.reusedAll;
    } else if (source.images.length === 0) {
      mediaState = "skipped";
    }

    let aiState: AiState = options.template === "raw" || preserveKnowledgeCard ? "not_requested" : "disabled";
    let aiError: string | undefined;
    let knowledgeCard = options.template === "raw" ? undefined : createPlaceholderCard(options.template);
    if (!preserveKnowledgeCard && options.template !== "raw" && options.generateWithAi) {
      if (!aiIsConfigured(this.settings, this.aiApiKey)) {
        aiState = "failed";
        aiError = "AI 尚未完成配置，已保留可手填模板。";
      } else {
        try {
          knowledgeCard = await this.aiClient.generate(source, options.template, this.settings, this.aiApiKey);
          aiState = "complete";
        } catch (error) {
          this.assertActive();
          aiState = "failed";
          aiError = sanitizeDiagnostic(error);
        }
      }
    }

    const captureState = source.body && source.extractionMethod === "initial_state" ? "complete" : "partial";
    const writeInput = {
      source,
      ...(knowledgeCard ? { knowledgeCard } : {}),
      template: options.template,
      captureState,
      mediaState,
      aiState,
      preserveKnowledgeCard,
      preserveMediaState,
      ...(aiError ? { aiError } : {})
    } as const;
    this.assertActive();
    const written = await this.writer.writeNote(writeInput);
    const warnings = [
      ...source.warnings,
      ...source.images.flatMap((image) => image.downloadError ? [image.downloadError] : []),
      ...(aiError ? [aiError] : [])
    ];
    return {
      outcome: written.outcome,
      sourceId: source.sourceId,
      title: source.title,
      displayUrl: source.canonicalUrl,
      ...(written.path ? { path: written.path } : {}),
      ...(written.reason ? { reason: written.reason } : {}),
      warnings
    };
  }

  async importPreviews(
    previews: PreviewItem[],
    options: ImportOptions,
    onProgress?: (progress: BatchProgress) => void
  ): Promise<BatchImportResult> {
    const results: ImportResult[] = [];
    let completed = 0;
    for (const preview of previews) {
      this.assertActive();
      if (preview.kind === "failure") {
        results.push({
          outcome: "failed",
          title: "无法预览的链接",
          displayUrl: preview.displayUrl,
          reason: `${preview.reason} ${preview.recovery}`,
          warnings: []
        });
      } else {
        try {
          results.push(await this.importOne(preview, options));
        } catch (error) {
          this.assertActive();
          results.push({
            outcome: "failed",
            sourceId: preview.source.sourceId,
            title: preview.source.title,
            displayUrl: preview.source.canonicalUrl,
            reason: sanitizeDiagnostic(error),
            warnings: []
          });
        }
      }
      completed += 1;
      onProgress?.({ completed, total: previews.length, label: "正在保存" });
    }

    this.assertActive();

    const needsReport = results.length > 1 || results.some((result) => ["failed", "partial", "skipped"].includes(result.outcome));
    if (!needsReport) return { results };
    try {
      return { results, reportPath: await this.writer.writeReport(results) };
    } catch (error) {
      results.push({
        outcome: "failed",
        title: "导入报告",
        displayUrl: "local-report",
        reason: `内容已逐条处理，但报告写入失败：${sanitizeDiagnostic(error)}`,
        warnings: []
      });
      return { results };
    }
  }
}
