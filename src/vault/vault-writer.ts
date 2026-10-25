import type { App, TFile } from "obsidian";
import type { ImportOutcome, ImportResult, WriteNoteInput } from "../types";
import type { EvidenceInboxSettings } from "../settings";
import {
  MANAGED_END,
  MANAGED_START,
  managedFrontmatter,
  mergeManagedBlock,
  renderManagedBlock,
  renderNewNote
} from "../core/markdown";
import { joinVaultPath, safeFilename, stableNoteFilename } from "../core/paths";
import { sanitizeDiagnostic } from "../core/security";

async function ensureFolder(app: App, folderPath: string): Promise<void> {
  const parts = folderPath.split("/").filter(Boolean);
  let current = "";
  for (const part of parts) {
    current = current ? `${current}/${part}` : part;
    if (!await app.vault.adapter.exists(current)) await app.vault.createFolder(current);
  }
}

function resultOutcome(input: WriteNoteInput, base: "created" | "updated"): ImportOutcome {
  return input.captureState === "partial" || input.mediaState === "partial" || input.aiState === "failed"
    ? "partial"
    : base;
}

export interface WriteResult {
  outcome: ImportOutcome;
  path?: string;
  reason?: string;
}

export interface ExistingSourceNote {
  file: TFile;
  managed: boolean;
}

function sourceIdFromContent(content: string): string {
  const frontmatter = content.match(/^---\r?\n([\s\S]*?)\r?\n---/u)?.[1] ?? "";
  const raw = frontmatter.match(/^evidence_source_id\s*:\s*(.+)$/mu)?.[1]?.trim() ?? "";
  if (!raw) return "";
  try {
    const parsed = JSON.parse(raw);
    return typeof parsed === "string" ? parsed.trim() : String(parsed ?? "").trim();
  } catch {
    return raw.replace(/^['"]|['"]$/g, "").trim();
  }
}

function frontmatterTags(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String).map((item) => item.trim()).filter(Boolean);
  if (typeof value === "string") return value.split(",").map((item) => item.trim()).filter(Boolean);
  return [];
}

export class EvidenceVaultWriter {
  private readonly sourceIndex = new Map<string, TFile>();
  private sourceIndexPromise: Promise<void> | null = null;
  constructor(
    private readonly app: App,
    private readonly settings: EvidenceInboxSettings
  ) {}

  private async ensureSourceIndex(): Promise<void> {
    if (!this.sourceIndexPromise) {
      this.sourceIndexPromise = (async () => {
        for (const file of this.app.vault.getMarkdownFiles()) {
          const frontmatter = this.app.metadataCache.getFileCache(file)?.frontmatter;
          let candidate = String(frontmatter?.evidence_source_id ?? "").trim();
          if (!candidate && !frontmatter) candidate = sourceIdFromContent(await this.app.vault.read(file));
          candidate = candidate.toLowerCase();
          if (candidate && !this.sourceIndex.has(candidate)) this.sourceIndex.set(candidate, file);
        }
      })();
    }
    await this.sourceIndexPromise;
  }

  async findBySourceId(sourceId: string): Promise<TFile | null> {
    await this.ensureSourceIndex();
    return this.sourceIndex.get(sourceId.toLowerCase()) ?? null;
  }

  async inspectSource(sourceId: string): Promise<ExistingSourceNote | null> {
    const file = await this.findBySourceId(sourceId);
    if (!file) return null;
    const content = await this.app.vault.read(file);
    return {
      file,
      managed: content.includes(MANAGED_START) && content.includes(MANAGED_END)
    };
  }

  async plannedPath(title: string, sourceId: string): Promise<string> {
    const existing = await this.findBySourceId(sourceId);
    if (existing) return existing.path;
    return joinVaultPath(this.settings.captureFolder, stableNoteFilename(title, sourceId));
  }

  private async availablePath(title: string, sourceId: string): Promise<string> {
    const filename = stableNoteFilename(title, sourceId);
    const stem = filename.slice(0, -3);
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const suffix = attempt === 0 ? "" : `-${attempt + 1}`;
      const candidate = joinVaultPath(this.settings.captureFolder, `${stem}${suffix}.md`);
      if (!await this.app.vault.adapter.exists(candidate)) return candidate;
    }
    throw new Error("无法为笔记分配安全文件名。");
  }

  async writeNote(input: WriteNoteInput): Promise<WriteResult> {
    await ensureFolder(this.app, this.settings.captureFolder);
    const existing = await this.findBySourceId(input.source.sourceId);
    if (existing) {
      let replaced = false;
      await this.app.vault.process(existing, (current) => {
        const merged = mergeManagedBlock(current, renderManagedBlock(input));
        replaced = merged.replaced;
        return merged.content;
      });
      if (!replaced) {
        return {
          outcome: "skipped",
          path: existing.path,
          reason: "已有同源笔记，但没有 Evidence Inbox 管理标记；为保护原文已跳过更新。"
        };
      }
      try {
        await this.app.fileManager.processFrontMatter(existing, (frontmatter) => {
          const currentTags = frontmatterTags(frontmatter.tags);
          const previousTemplate = frontmatter.knowledge_template;
          const previousAiState = frontmatter.ai_status;
          const previousMediaState = frontmatter.media_status;
          const next = managedFrontmatter(input);
          const nextTags = frontmatterTags(next.tags);
          Object.assign(frontmatter, next, { tags: [...new Set([...currentTags, ...nextTags])] });
          if (!input.source.publishedAt) delete frontmatter.published_at;
          if (input.preserveKnowledgeCard) {
            if (previousTemplate === undefined) delete frontmatter.knowledge_template;
            else frontmatter.knowledge_template = previousTemplate;
            if (previousAiState === undefined) delete frontmatter.ai_status;
            else frontmatter.ai_status = previousAiState;
          }
          if (input.preserveMediaState) {
            if (previousMediaState === undefined) delete frontmatter.media_status;
            else frontmatter.media_status = previousMediaState;
          }
        });
      } catch (error) {
        this.sourceIndex.set(input.source.sourceId.toLowerCase(), existing);
        return {
          outcome: "partial",
          path: existing.path,
          reason: `来源区已刷新，但 YAML 状态更新失败；重试可修复：${sanitizeDiagnostic(error)}`
        };
      }
      this.sourceIndex.set(input.source.sourceId.toLowerCase(), existing);
      return { outcome: resultOutcome(input, "updated"), path: existing.path };
    }

    const path = await this.availablePath(input.source.title, input.source.sourceId);
    const file = await this.app.vault.create(path, renderNewNote(input));
    this.sourceIndex.set(input.source.sourceId.toLowerCase(), file);
    return { outcome: resultOutcome(input, "created"), path: file.path };
  }

  async writeReport(results: ImportResult[]): Promise<string> {
    await ensureFolder(this.app, this.settings.reportFolder);
    const now = new Date();
    const timestamp = now.toISOString().replace(/[:.]/g, "-");
    const path = joinVaultPath(this.settings.reportFolder, `导入报告-${timestamp}.md`);
    const counts = new Map<ImportOutcome, number>();
    for (const result of results) counts.set(result.outcome, (counts.get(result.outcome) ?? 0) + 1);
    const rows = results.map((result) => {
      const title = safeFilename(result.title, "未命名", 100).replace(/\|/g, "¦");
      const detail = result.reason
        ? sanitizeDiagnostic(result.reason).replace(/\|/g, "¦")
        : result.warnings.map((warning) => sanitizeDiagnostic(warning)).join("；").replace(/\|/g, "¦");
      const output = result.path
        ? `[打开笔记](</${result.path.split("/").map((part) => encodeURIComponent(part)).join("/")}>)`
        : "—";
      return `| ${result.outcome} | ${title} | ${output} | ${detail || "—"} |`;
    });
    const content = [
      "---",
      'generated_by: "evidence-inbox"',
      `generated_at: ${JSON.stringify(now.toISOString())}`,
      `total: ${results.length}`,
      "---",
      "# Evidence Inbox 导入报告",
      "",
      `- 新建：${counts.get("created") ?? 0}`,
      `- 更新：${counts.get("updated") ?? 0}`,
      `- 部分完成：${counts.get("partial") ?? 0}`,
      `- 跳过：${counts.get("skipped") ?? 0}`,
      `- 失败：${counts.get("failed") ?? 0}`,
      "",
      "| 结果 | 标题 | 输出 | 说明 |",
      "| --- | --- | --- | --- |",
      ...rows,
      "",
      "> 报告不保存 Cookie、API Key、分享参数或原始页面数据。",
      ""
    ].join("\n");
    const file = await this.app.vault.create(path, content);
    return file.path;
  }
}
