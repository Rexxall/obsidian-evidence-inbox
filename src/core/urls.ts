import { isAllowedXhsPageUrl, stripUrlSecrets } from "./security";

const URL_PATTERN = /https?:\/\/[^\s<>"'，。；、）】]+/giu;
const NOTE_PATH_PATTERN = /^\/(?:explore|discovery\/item)\/([0-9a-fA-F]{24})\/?$/;

export interface ParsedShareUrls {
  urls: string[];
  rejected: string[];
  truncated: boolean;
}

function trimTrailingPunctuation(value: string): string {
  return value.replace(/[),.;!?，。；！？、）】》」』]+$/u, "");
}

export function extractShareUrls(input: string, maxItems = 10): ParsedShareUrls {
  const seen = new Set<string>();
  const urls: string[] = [];
  const rejected: string[] = [];
  const matches = input.match(URL_PATTERN) ?? [];

  for (const match of matches) {
    // Older share texts use http:// short links; the page is always fetched over https.
    const candidate = trimTrailingPunctuation(match).replace(/^http:\/\//i, "https://");
    if (!isAllowedXhsPageUrl(candidate)) {
      rejected.push(stripUrlSecrets(candidate));
      continue;
    }
    let normalized: string;
    try {
      const parsed = new URL(candidate);
      parsed.hash = "";
      normalized = parsed.toString();
    } catch {
      rejected.push("unsupported-url");
      continue;
    }
    const noteId = extractNoteIdFromUrl(normalized);
    const dedupeKey = noteId ? `note:${noteId.toLowerCase()}` : stripUrlSecrets(normalized);
    if (!seen.has(dedupeKey)) {
      seen.add(dedupeKey);
      urls.push(normalized);
    }
  }

  return {
    urls: urls.slice(0, maxItems),
    rejected,
    truncated: urls.length > maxItems
  };
}

export function extractNoteIdFromUrl(value: string): string | null {
  try {
    const url = new URL(value);
    const match = url.pathname.match(NOTE_PATH_PATTERN);
    return match?.[1] ?? null;
  } catch {
    return null;
  }
}

export function canonicalXhsUrl(noteId: string): string {
  return `https://www.xiaohongshu.com/explore/${encodeURIComponent(noteId)}`;
}
