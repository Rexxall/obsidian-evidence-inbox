import type { EvidenceSource } from "../types";
import { parseXhsPage } from "../core/xhs-parser";
import { isAllowedXhsPageUrl } from "../core/security";
import type { HttpGateway } from "./http";

const MAX_HTML_LENGTH = 8_000_000;

export class XhsPublicClient {
  constructor(private readonly http: HttpGateway, private readonly signal?: AbortSignal) {}

  async fetchPublicNote(inputUrl: string): Promise<EvidenceSource> {
    if (!isAllowedXhsPageUrl(inputUrl)) {
      throw new Error("只支持小红书公开页面或 xhslink 分享链接。");
    }
    const response = await this.http.getText(inputUrl, 20_000, "xhs-page", this.signal);
    if (response.status < 200 || response.status >= 400) {
      throw new Error(`公开页面请求失败（HTTP ${response.status}）。`);
    }
    if (response.text.length > MAX_HTML_LENGTH) {
      throw new Error("公开页面体积异常，已停止解析。");
    }
    return parseXhsPage(response.text, { requestedUrl: inputUrl });
  }
}
