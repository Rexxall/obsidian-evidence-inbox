import { isAllowedXhsPageUrl, stripUrlSecrets } from "./security";

const URL_PATTERN = /https?:\/\/[^\s<>"'，。；、）】]+/giu;
const NOTE_PATH_PATTERN = /^\/(?:explore|discovery\/item)\/([0-9a-fA-F]{24})\/?$/;
/** Other places a note is opened from on the web; all of them show the same note as /explore/<id>. */
const ALIAS_NOTE_PATH_PATTERN = /^\/(?:user\/profile\/[0-9a-zA-Z]{1,64}|search_result)\/([0-9a-fA-F]{24})\/?$/;
const NOTE_HOSTS = new Set(["xiaohongshu.com", "www.xiaohongshu.com", "m.xiaohongshu.com", "rednote.com", "www.rednote.com"]);

/** Rewrites a note opened from a profile or search page to its /explore/<id> form, keeping the share query. */
export function normalizeNotePath(value: string): string {
  try {
    const url = new URL(value);
    if (!NOTE_HOSTS.has(url.hostname.toLowerCase())) return value;
    const match = url.pathname.match(ALIAS_NOTE_PATH_PATTERN);
    if (!match) return value;
    url.pathname = `/explore/${match[1]}`;
    return url.toString();
  } catch {
    return value;
  }
}

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
    const candidate = normalizeNotePath(trimTrailingPunctuation(match).replace(/^http:\/\//i, "https://"));
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
