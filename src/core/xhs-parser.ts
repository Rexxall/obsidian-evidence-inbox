import type { EvidenceSource, RemoteImage } from "../types";
import { canonicalXhsUrl, extractNoteIdFromUrl } from "./urls";
import { isAllowedMediaUrl } from "./security";

type JsonRecord = Record<string, unknown>;

const INITIAL_STATE_PATTERN = /window\.__INITIAL_STATE__\s*=\s*/g;

function asRecord(value: unknown): JsonRecord | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : null;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function asString(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return "";
}

function decodeHtmlEntities(value: string): string {
  const named: Record<string, string> = {
    amp: "&",
    apos: "'",
    gt: ">",
    lt: "<",
    nbsp: " ",
    quot: '"'
  };
  return value.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (match, entity: string) => {
    if (entity.startsWith("#")) {
      const hexadecimal = entity[1]?.toLowerCase() === "x";
      const digits = hexadecimal ? entity.slice(2) : entity.slice(1);
      const codePoint = Number.parseInt(digits, hexadecimal ? 16 : 10);
      if (Number.isFinite(codePoint) && codePoint >= 0 && codePoint <= 0x10ffff) {
        return String.fromCodePoint(codePoint);
      }
      return match;
    }
    return named[entity.toLowerCase()] ?? match;
  });
}

function cleanText(value: string): string {
  return decodeHtmlEntities(value)
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Replaces JavaScript's unquoted `undefined` token without touching string values. */
export function normalizeInitialStateJson(value: string): string {
  let output = "";
  let quote: '"' | "'" | null = null;
  let escaped = false;

  for (let index = 0; index < value.length; index += 1) {
    const character = value[index] ?? "";
    if (quote) {
      output += character;
      if (escaped) {
        escaped = false;
      } else if (character === "\\") {
        escaped = true;
      } else if (character === quote) {
        quote = null;
      }
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      output += character;
      continue;
    }
    if (value.startsWith("undefined", index)) {
      const before = value[index - 1] ?? "";
      const after = value[index + "undefined".length] ?? "";
      if (!/[A-Za-z0-9_$]/.test(before) && !/[A-Za-z0-9_$]/.test(after)) {
        output += "null";
        index += "undefined".length - 1;
        continue;
      }
    }
    output += character;
  }
  return output;
}

export function extractInitialState(html: string): JsonRecord | null {
  INITIAL_STATE_PATTERN.lastIndex = 0;
  const marker = INITIAL_STATE_PATTERN.exec(html);
  if (!marker) return null;
  const start = marker.index + marker[0].length;
  const end = html.indexOf("</script>", start);
  if (end < 0) return null;
  const raw = html.slice(start, end).trim().replace(/;\s*$/, "");
  if (!raw || raw.length > 8_000_000) return null;
  try {
    return asRecord(JSON.parse(normalizeInitialStateJson(raw)));
  } catch {
    return null;
  }
}

function getMetaContent(html: string, key: string): string {
  const tagPattern = /<meta\b[^>]*>/gi;
  const attributePattern = /([:\w-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/g;
  for (const tagMatch of html.matchAll(tagPattern)) {
    const attributes: Record<string, string> = {};
    attributePattern.lastIndex = 0;
    for (const attributeMatch of tagMatch[0].matchAll(attributePattern)) {
      const name = (attributeMatch[1] ?? "").toLowerCase();
      attributes[name] = decodeHtmlEntities(attributeMatch[2] ?? attributeMatch[3] ?? attributeMatch[4] ?? "");
    }
    if ((attributes.property ?? attributes.name)?.toLowerCase() === key.toLowerCase()) {
      return cleanText(attributes.content ?? "");
    }
  }
  return "";
}

function getHtmlTitle(html: string): string {
  const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "";
  return cleanText(title.replace(/\s*[-|]\s*小红书\s*$/u, ""));
}

function selectNote(state: JsonRecord | null, requestedNoteId: string | null): { id: string; note: JsonRecord } | null {
  const noteRoot = asRecord(state?.note);
  const detailMap = asRecord(noteRoot?.noteDetailMap);
  if (!detailMap) return null;
  const ids = Object.keys(detailMap);
  const id = requestedNoteId
    ? (detailMap[requestedNoteId] ? requestedNoteId : undefined)
    : (ids.length === 1 ? ids[0] : undefined);
  if (!id) return null;
  const detail = asRecord(detailMap[id]);
  const note = asRecord(detail?.note) ?? detail;
  return note ? { id, note } : null;
}

function extractAuthor(note: JsonRecord): string {
  const user = asRecord(note.user);
  return asString(user?.nickname ?? user?.nickName ?? user?.name ?? note.nickname ?? note.author);
}

function extractTags(note: JsonRecord, body: string): string[] {
  const tags = new Set<string>();
  for (const item of asArray(note.tagList ?? note.tags)) {
    const record = asRecord(item);
    const tag = [...cleanText(asString(record?.name ?? record?.title ?? item)).replace(/^#/, "")].slice(0, 50).join("");
    if (tag) tags.add(tag);
  }
  for (const match of body.matchAll(/#([\p{L}\p{N}_-]{1,50})/gu)) {
    const tag = match[1]?.trim();
    if (tag) tags.add(tag);
  }
  return [...tags].slice(0, 50);
}

function firstAllowedUrl(values: unknown[]): string {
  for (const value of values) {
    const candidate = asString(value);
    if (candidate && isAllowedMediaUrl(candidate)) return candidate;
  }
  return "";
}

function imageUrlFromRecord(record: JsonRecord): string {
  const infoUrls = asArray(record.infoList)
    .map((item) => asRecord(item))
    .flatMap((item) => [item?.url, item?.urlDefault, item?.urlPre]);
  return firstAllowedUrl([
    record.urlDefault,
    record.urlPre,
    record.url,
    record.originUrl,
    ...infoUrls
  ]);
}

function extractImages(note: JsonRecord, html: string): RemoteImage[] {
  const seen = new Set<string>();
  const images: RemoteImage[] = [];
  for (const item of asArray(note.imageList ?? note.images)) {
    const record = asRecord(item);
    const remoteUrl = record ? imageUrlFromRecord(record) : asString(item);
    if (remoteUrl && isAllowedMediaUrl(remoteUrl) && !seen.has(remoteUrl)) {
      seen.add(remoteUrl);
      images.push({ remoteUrl });
    }
  }
  const ogImage = getMetaContent(html, "og:image");
  if (ogImage && isAllowedMediaUrl(ogImage) && !seen.has(ogImage)) images.push({ remoteUrl: ogImage });
  return images.slice(0, 30);
}

function normalizePublishedAt(value: unknown): string | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    const milliseconds = value < 10_000_000_000 ? value * 1000 : value;
    const date = new Date(milliseconds);
    return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
  }
  const stringValue = asString(value);
  if (!stringValue) return undefined;
  const numeric = Number(stringValue);
  if (Number.isFinite(numeric)) return normalizePublishedAt(numeric);
  const date = new Date(stringValue);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

export interface ParseXhsPageOptions {
  requestedUrl: string;
  capturedAt?: string;
}

export class UnsupportedXhsPageError extends Error {
  constructor(message = "没有在公开页面中找到可导入的小红书笔记。") {
    super(message);
    this.name = "UnsupportedXhsPageError";
  }
}

export function parseXhsPage(html: string, options: ParseXhsPageOptions): EvidenceSource {
  if (!html.trim()) throw new UnsupportedXhsPageError("小红书返回了空页面。");
  const requestedNoteId = extractNoteIdFromUrl(options.requestedUrl);
  const metadataNoteId = extractNoteIdFromUrl(getMetaContent(html, "og:url"));
  const state = extractInitialState(html);
  const selected = selectNote(state, requestedNoteId);
  const note = selected?.note ?? {};
  const embeddedNoteId = asString(note.id ?? note.noteId);
  if (selected && embeddedNoteId && embeddedNoteId.toLowerCase() !== selected.id.toLowerCase()) {
    throw new UnsupportedXhsPageError("公开页面返回了不一致的笔记标识，已停止导入。");
  }
  const identifiers = [requestedNoteId, metadataNoteId, selected?.id, embeddedNoteId].filter((value): value is string => Boolean(value));
  if (new Set(identifiers.map((value) => value.toLowerCase())).size > 1) {
    throw new UnsupportedXhsPageError("公开页面返回了不一致的笔记标识，已停止导入。");
  }
  if (!selected) {
    if (!metadataNoteId || requestedNoteId && metadataNoteId !== requestedNoteId) {
      throw new UnsupportedXhsPageError("页面没有提供与链接一致的公开笔记证据。");
    }
  }
  const rawSourceId = embeddedNoteId || selected?.id || metadataNoteId || "";
  if (!rawSourceId || !/^[0-9a-fA-F]{24}$/.test(rawSourceId)) {
    throw new UnsupportedXhsPageError("该链接不是公开笔记，或页面结构暂不受支持。");
  }
  const sourceId = rawSourceId.toLowerCase();

  const title = cleanText(
    asString(note.title ?? note.displayTitle) || getMetaContent(html, "og:title") || getHtmlTitle(html)
  ) || "未命名小红书笔记";
  const body = cleanText(
    asString(note.desc ?? note.content) || getMetaContent(html, "og:description") || getMetaContent(html, "description")
  );
  const author = extractAuthor(note) || getMetaContent(html, "author") || "未知作者";
  const images = extractImages(note, html);
  const shellTitle = getHtmlTitle(html).toLowerCase();
  const hasChallengeShell = /captcha|verify|verification|access denied|not found|安全验证|访问受限|页面不存在|笔记不存在|内容不存在|请登录/.test(shellTitle)
    || /(?:id|class)=["'][^"']*(?:captcha|verify|error-page)[^"']*["']/i.test(html);
  if (!selected && hasChallengeShell) {
    throw new UnsupportedXhsPageError("小红书返回了验证、登录或不可用页面。");
  }
  if (!selected && !body && images.length === 0) {
    throw new UnsupportedXhsPageError("公开元数据不足，无法确认这是一篇可归档笔记。");
  }
  const sourceType = asString(note.type).toLowerCase();
  const warnings: string[] = [];
  if (!body) warnings.push("未提取到正文，请打开原链接核对。");
  if (images.length === 0 && sourceType !== "video") warnings.push("未提取到公开图片。");

  const publishedAt = normalizePublishedAt(note.time ?? note.publishTime ?? note.lastUpdateTime);
  if (!selected) warnings.push("仅提取到公开 Open Graph 元数据，正文可能被截断。");
  return {
    platform: "xiaohongshu",
    sourceId,
    canonicalUrl: canonicalXhsUrl(sourceId),
    title: title.slice(0, 300),
    author: author.slice(0, 120),
    body,
    tags: extractTags(note, body),
    ...(publishedAt ? { publishedAt } : {}),
    sourceKind: sourceType === "video" ? "video" : images.length > 0 ? "image" : "unknown",
    images,
    capturedAt: options.capturedAt ?? new Date().toISOString(),
    warnings,
    extractionMethod: selected ? "initial_state" : "open_graph"
  };
}
