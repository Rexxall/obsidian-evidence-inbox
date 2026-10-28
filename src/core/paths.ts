// eslint-disable-next-line no-control-regex -- control characters are exactly what must be rejected
const FORBIDDEN_FILENAME = /[\\/:*?"<>|[\]#^\u0000-\u001f\u007f]/g;
// eslint-disable-next-line no-control-regex -- control characters are exactly what must be rejected
const FORBIDDEN_VAULT_PART = /[[\]|#^\u0000-\u001f\u007f]/;

/** `configDir` is the vault's own config folder when it is not the usual `.obsidian`. */
export function normalizeVaultFolder(value: string, fallback: string, configDir = ".obsidian"): string {
  const parts = value
    .replace(/\\/g, "/")
    .split("/")
    .map((part) => part.trim())
    .filter(Boolean);
  if (
    parts.length === 0 ||
    parts.some((part) => part === "." || part === "..") ||
    parts.some((part) => FORBIDDEN_VAULT_PART.test(part)) ||
    parts[0]?.toLowerCase().startsWith(".obsidian") === true ||
    parts[0]?.toLowerCase() === configDir.replace(/^\/+|\/+$/g, "").toLowerCase()
  ) {
    return fallback;
  }
  return parts.join("/");
}

export function safeFilename(value: string, fallback = "未命名", maxLength = 80): string {
  const cleaned = value
    .normalize("NFC")
    .replace(FORBIDDEN_FILENAME, "-")
    .replace(/\s+/g, " ")
    .replace(/[. ]+$/g, "")
    .replace(/^\.+/g, "")
    .trim();
  return [...(cleaned || fallback)].slice(0, maxLength).join("");
}

export function stableNoteFilename(title: string, sourceId: string): string {
  const suffix = safeFilename(sourceId, "source", 24);
  return `${safeFilename(title, "未命名", 72)}--${suffix}.md`;
}

export function joinVaultPath(...parts: string[]): string {
  return parts
    .flatMap((part) => part.replace(/\\/g, "/").split("/"))
    .map((part) => part.trim())
    .filter(Boolean)
    .join("/");
}

export function mediaExtension(contentType: string, remoteUrl: string): string {
  const normalizedType = contentType.split(";", 1)[0]?.trim().toLowerCase() ?? "";
  const typeMap: Record<string, string> = {
    "image/avif": "avif",
    "image/gif": "gif",
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp"
  };
  if (typeMap[normalizedType]) return typeMap[normalizedType];
  try {
    const extension = new URL(remoteUrl).pathname.match(/\.([a-zA-Z0-9]{2,5})$/)?.[1]?.toLowerCase();
    if (extension && ["avif", "gif", "jpeg", "jpg", "png", "webp"].includes(extension)) {
      return extension === "jpeg" ? "jpg" : extension;
    }
  } catch {
    // The URL was validated before this helper is called; fall back conservatively.
  }
  return "jpg";
}
