import type { App, TFile } from "obsidian";
import type { RemoteImage } from "../types";
import { isAllowedMediaUrl, sanitizeDiagnostic } from "../core/security";
import { joinVaultPath, mediaExtension } from "../core/paths";
import type { HttpGateway } from "./http";

const MAX_IMAGE_BYTES = 15 * 1024 * 1024;
const MEDIA_EXTENSIONS = ["avif", "gif", "jpg", "png", "webp"] as const;

function isSupportedImage(bytes: Uint8Array): boolean {
  const ascii = (start: number, length: number) => String.fromCharCode(...bytes.slice(start, start + length));
  return (
    (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) ||
    (bytes[0] === 0x89 && ascii(1, 3) === "PNG") ||
    ascii(0, 6) === "GIF87a" ||
    ascii(0, 6) === "GIF89a" ||
    (ascii(0, 4) === "RIFF" && ascii(8, 4) === "WEBP") ||
    ascii(4, 8) === "ftypavif" ||
    ascii(4, 8) === "ftypavis"
  );
}

async function ensureFolder(app: App, folderPath: string): Promise<void> {
  const parts = folderPath.split("/").filter(Boolean);
  let current = "";
  for (const part of parts) {
    current = current ? `${current}/${part}` : part;
    if (!await app.vault.adapter.exists(current)) await app.vault.createFolder(current);
  }
}

export class MediaDownloader {
  constructor(
    private readonly app: App,
    private readonly http: HttpGateway,
    private readonly mediaFolder: string,
    private readonly signal?: AbortSignal
  ) {}

  async localize(sourceId: string, images: RemoteImage[]): Promise<RemoteImage[]> {
    try {
      await ensureFolder(this.app, this.mediaFolder);
    } catch (error) {
      const reason = `图片目录不可用：${sanitizeDiagnostic(error)}`;
      return images.map((image) => ({ ...image, downloadError: reason }));
    }
    const localized: RemoteImage[] = [];
    for (let index = 0; index < images.length; index += 1) {
      if (this.signal?.aborted) throw new Error("操作已取消。");
      const image = images[index]!;
      if (!isAllowedMediaUrl(image.remoteUrl)) {
        localized.push({ ...image, downloadError: "图片地址不在允许的小红书媒体域名中。" });
        continue;
      }
      try {
        const response = await this.http.getBinary(image.remoteUrl, 25_000, "xhs-media", this.signal);
        if (response.status < 200 || response.status >= 300) {
          throw new Error(`HTTP ${response.status}`);
        }
        if (response.arrayBuffer.byteLength === 0 || response.arrayBuffer.byteLength > MAX_IMAGE_BYTES) {
          throw new Error("图片为空或超过 15 MB 限制");
        }
        const contentType = (response.headers["content-type"] ?? "").split(";", 1)[0]?.trim().toLowerCase() ?? "";
        if (contentType && !contentType.startsWith("image/")) throw new Error("响应 MIME 类型不是图片");
        const bytes = new Uint8Array(response.arrayBuffer);
        if (!isSupportedImage(bytes)) throw new Error("响应内容不是受支持的图片格式");
        const extension = mediaExtension(contentType, image.remoteUrl);
        const path = joinVaultPath(this.mediaFolder, `${sourceId}-${String(index + 1).padStart(2, "0")}.${extension}`);
        const existing = this.app.vault.getAbstractFileByPath(path);
        if (existing && "extension" in existing) {
          await this.app.vault.modifyBinary(existing as TFile, response.arrayBuffer);
        } else if (await this.app.vault.adapter.exists(path)) {
          throw new Error("目标图片路径被非文件项目占用");
        } else {
          await this.app.vault.createBinary(path, response.arrayBuffer);
        }
        localized.push({ remoteUrl: image.remoteUrl, localPath: path });
      } catch (error) {
        if (this.signal?.aborted) throw new Error("操作已取消。");
        localized.push({ ...image, downloadError: sanitizeDiagnostic(error) });
      }
    }
    return localized;
  }
}

export async function reuseExistingMedia(
  app: App,
  mediaFolder: string,
  sourceId: string,
  images: RemoteImage[]
): Promise<{ images: RemoteImage[]; reusedAll: boolean }> {
  const reused: RemoteImage[] = [];
  for (let index = 0; index < images.length; index += 1) {
    const image = images[index]!;
    let localPath: string | undefined;
    for (const extension of MEDIA_EXTENSIONS) {
      const candidate = joinVaultPath(mediaFolder, `${sourceId}-${String(index + 1).padStart(2, "0")}.${extension}`);
      const existing = app.vault.getAbstractFileByPath(candidate);
      if (existing && "extension" in existing) {
        localPath = candidate;
        break;
      }
    }
    reused.push(localPath ? { ...image, localPath } : image);
  }
  return { images: reused, reusedAll: reused.length > 0 && reused.every((image) => Boolean(image.localPath)) };
}
