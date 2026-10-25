const XHS_PAGE_HOSTS = new Set([
  "xiaohongshu.com",
  "www.xiaohongshu.com",
  "m.xiaohongshu.com",
  "xhslink.com",
  "www.xhslink.com",
  "xhslink.cn",
  "www.xhslink.cn"
]);
const XHS_NOTE_PATH_PATTERN = /^\/(?:explore|discovery\/item)\/[0-9a-fA-F]{24}\/?$/;
const XHS_SHORT_PATH_PATTERN = /^\/[a-zA-Z0-9_-]{1,32}\/[a-zA-Z0-9_-]{2,128}\/?$/;

const SECRET_KEY_PATTERN = /\b(?:api[_-]?key|x-api-key|key|token|cookie|authorization|a1|web_session)[-_a-z0-9]*\s*[:=]\s*[^\s,;]+/gi;
const SENSITIVE_HEADER_PATTERN = /\b(?:authorization|cookie|set-cookie|x-api-key)\s*[:=]\s*[^\r\n]+/gi;
const SENSITIVE_JSON_PATTERN = /["'](?:authorization|cookie|set-cookie|x-api-key|api[_-]?key|token)["']\s*:\s*["'][^"'\r\n]*["']/gi;
const BARE_KEY_PATTERN = /\bsk-[a-z0-9_-]{8,}\b/gi;
const BEARER_PATTERN = /\bbearer\s+[a-z0-9._~+\/-]{8,}/gi;
const URL_QUERY_PATTERN = /(https?:\/\/[^\s?#]+)[?#][^\s]*/gi;

export function isAllowedXhsPageUrl(value: string): boolean {
  try {
    const url = new URL(value);
    const hostname = url.hostname.toLowerCase();
    if (
      url.protocol !== "https:" ||
      url.port && url.port !== "443" ||
      url.username ||
      url.password ||
      !XHS_PAGE_HOSTS.has(hostname)
    ) return false;
    const shortHost = hostname === "xhslink.com" || hostname === "www.xhslink.com" || hostname === "xhslink.cn" || hostname === "www.xhslink.cn";
    return shortHost ? XHS_SHORT_PATH_PATTERN.test(url.pathname) : XHS_NOTE_PATH_PATTERN.test(url.pathname);
  } catch {
    return false;
  }
}

export function isAllowedMediaUrl(value: string): boolean {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.port && url.port !== "443" || url.username || url.password) return false;
    const hostname = url.hostname.toLowerCase();
    return (
      hostname === "xhscdn.com" ||
      hostname.endsWith(".xhscdn.com") ||
      hostname === "xiaohongshu.com" ||
      hostname.endsWith(".xiaohongshu.com")
    );
  } catch {
    return false;
  }
}

export function stripUrlSecrets(value: string): string {
  try {
    const url = new URL(value);
    url.username = "";
    url.password = "";
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    return "unsupported-url";
  }
}

export function sanitizeDiagnostic(value: unknown, maxLength = 240): string {
  const raw = value instanceof Error ? value.message : String(value ?? "Unknown error");
  const sanitized = raw
    .replace(SENSITIVE_JSON_PATTERN, "[redacted]")
    .replace(SENSITIVE_HEADER_PATTERN, "[redacted]")
    .replace(SECRET_KEY_PATTERN, "[redacted]")
    .replace(BARE_KEY_PATTERN, "[redacted]")
    .replace(BEARER_PATTERN, "Bearer [redacted]")
    .replace(URL_QUERY_PATTERN, "$1")
    .replace(/[\r\n\t]+/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
  return (sanitized || "Unknown error").slice(0, maxLength);
}

export function safeAiEndpoint(value: string): URL | null {
  try {
    const url = new URL(value);
    const localHttp = url.protocol === "http:" && ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname);
    if (url.protocol !== "https:" && !localHttp) return null;
    url.username = "";
    url.password = "";
    url.search = "";
    url.hash = "";
    return url;
  } catch {
    return null;
  }
}
