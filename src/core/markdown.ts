import type { KnowledgeCard, KnowledgeTemplateId, WriteNoteInput } from "../types";
import { createPlaceholderCard, getTemplateDefinition } from "./knowledge-templates";
import { stripUrlSecrets } from "./security";

export const MANAGED_START = "<!-- evidence-inbox:managed:start -->";
export const MANAGED_END = "<!-- evidence-inbox:managed:end -->";
export const KNOWLEDGE_START = "<!-- evidence-inbox:knowledge:user-owned:start -->";
export const KNOWLEDGE_END = "<!-- evidence-inbox:knowledge:user-owned:end -->";
export const USER_START = "<!-- evidence-inbox:user:start -->";
export const USER_END = "<!-- evidence-inbox:user:end -->";

function yamlString(value: string): string {
  return JSON.stringify(value);
}

function yamlArray(values: string[]): string {
  return `[${values.map(yamlString).join(", ")}]`;
}

function safeSourceText(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/([\\`*_{}[\]()#+\-.!|>~$%^])/g, "\\$1")
    .trim();
}

function safeWikiPath(value: string): string {
  return value.replace(/[[\]|#^\r\n]/g, "-");
}

function renderList(values: string[]): string {
  return values.length ? values.map((value) => `- ${safeSourceText(value)}`).join("\n") : "- 未提供";
}

function renderKnowledgeCard(card: KnowledgeCard): string {
  const claims = card.claims
    .map((item) => `- **论点：** ${safeSourceText(item.claim)}\n  - **依据：** ${safeSourceText(item.evidence)}`)
    .join("\n");
  const fields = card.templateFields
    .map((field) => `### ${field.label}\n\n${safeSourceText(field.value)}`)
    .join("\n\n");
  return [
    `## ${getTemplateDefinition(card.template).label}`,
    "",
    "> [!warning] 待核验",
    "> 这是基于单一社交平台来源生成的整理草稿，不等于事实核验或个人结论。",
    "",
    "### 一句话核心洞察",
    "",
    safeSourceText(card.insight),
    "",
    "### 主要论点与依据",
    "",
    claims || "- 未提供",
    "",
    "### 需要进一步核验",
    "",
    renderList(card.verificationNeeded),
    "",
    "### 为什么与当前目标有关",
    "",
    safeSourceText(card.relevance),
    "",
    "### 可连接的项目或笔记",
    "",
    renderList(card.connections),
    "",
    "### 30 分钟下一步",
    "",
    safeSourceText(card.nextAction),
    "",
    fields
  ].filter((line, index, lines) => line !== "" || lines[index - 1] !== "").join("\n");
}

export function managedFrontmatter(input: WriteNoteInput): Record<string, string | string[]> {
  return {
    evidence_inbox_version: "1",
    platform: input.source.platform,
    evidence_source_id: input.source.sourceId,
    source_url: input.source.canonicalUrl,
    source_author: input.source.author,
    source_kind: input.source.sourceKind,
    extraction_method: input.source.extractionMethod,
    captured_at: input.source.capturedAt,
    ...(input.source.publishedAt ? { published_at: input.source.publishedAt } : {}),
    capture_status: input.captureState,
    media_status: input.mediaState,
    ai_status: input.aiState,
    knowledge_template: input.template,
    source_tags: input.source.tags,
    tags: ["evidence-inbox", "source/xiaohongshu", ...input.source.tags]
  };
}

export function renderFrontmatter(input: WriteNoteInput): string {
  const properties = managedFrontmatter(input);
  const lines = Object.entries(properties).map(([key, value]) =>
    `${key}: ${Array.isArray(value) ? yamlArray(value) : yamlString(value)}`
  );
  return `---\n${lines.join("\n")}\n---`;
}

export function renderManagedBlock(input: WriteNoteInput): string {
  const source = input.source;
  const images = source.images.length
    ? source.images.map((image, index) => {
        const reference = image.localPath
          ? `![[${safeWikiPath(image.localPath)}]]`
          : `![图片 ${index + 1}](<${stripUrlSecrets(image.remoteUrl)}>)`;
        return image.downloadError
          ? `${reference}\n\n> [!warning] 图片 ${index + 1} 本地化失败，暂用远程链接：${safeSourceText(image.downloadError)}`
          : reference;
      }).join("\n\n")
    : "（公开页面未提供可归档图片）";
  const warnings = [...source.warnings, ...(input.aiError ? [`AI 生成失败：${input.aiError}`] : [])];

  return [
    MANAGED_START,
    `# ${safeSourceText(source.title)}`,
    "",
    "> [!info] 来源",
    `> 作者：${safeSourceText(source.author)}  `,
    `> 原文：[打开小红书公开页面](${source.canonicalUrl})  `,
    `> 捕获时间：${source.capturedAt}`,
    warnings.length ? `> 状态提示：${warnings.map(safeSourceText).join("；")}` : "",
    "",
    "## 原始内容",
    "",
    safeSourceText(source.body) || "（未提取到正文，请打开原链接核对）",
    "",
    source.tags.length ? `标签： ${source.tags.map((tag) => `#${safeSourceText(tag)}`).join(" ")}` : "",
    "",
    "## 原始图片",
    "",
    images,
    MANAGED_END
  ].filter((line, index, lines) => line !== "" || lines[index - 1] !== "").join("\n");
}

export function renderKnowledgeBlock(input: WriteNoteInput): string {
  if (input.template === "raw") return "";
  return [
    KNOWLEDGE_START,
    "> [!tip] 用户内容保护区",
    "> 你可以直接修改下面的知识卡；重复导入只刷新来源区，不会覆盖这里。",
    "",
    renderKnowledgeCard(input.knowledgeCard ?? createPlaceholderCard(input.template)),
    KNOWLEDGE_END
  ].join("\n");
}

export function renderNewNote(input: WriteNoteInput): string {
  const knowledge = renderKnowledgeBlock(input);
  return [
    renderFrontmatter(input),
    "",
    renderManagedBlock(input),
    ...(knowledge ? ["", knowledge] : []),
    "",
    USER_START,
    "## 我的笔记",
    "",
    "",
    USER_END,
    ""
  ].join("\n");
}

export interface MergeManagedResult {
  content: string;
  replaced: boolean;
}

export function mergeManagedBlock(existingContent: string, nextManagedBlock: string): MergeManagedResult {
  const start = existingContent.indexOf(MANAGED_START);
  const end = existingContent.indexOf(MANAGED_END);
  if (start < 0 || end < start) return { content: existingContent, replaced: false };
  const afterEnd = end + MANAGED_END.length;
  return {
    content: `${existingContent.slice(0, start)}${nextManagedBlock}${existingContent.slice(afterEnd)}`,
    replaced: true
  };
}

export function templateNeedsCard(template: KnowledgeTemplateId): boolean {
  return template !== "raw";
}
