import { describe, expect, it } from "vitest";
import { TFile, type App } from "obsidian";
import { EvidenceImportService } from "../src/import/import-service";
import { normalizeSettings } from "../src/settings";
import type { EvidenceSource, PreviewFailure, PreviewSuccess } from "../src/types";
import type { HttpGateway, HttpBinaryResponse, HttpTextResponse } from "../src/network/http";

interface FakeFile {
  path: string;
  extension?: string;
}

function parseFrontmatter(content: string): Record<string, unknown> {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return {};
  const result: Record<string, unknown> = {};
  for (const line of (match[1] ?? "").split("\n")) {
    const separator = line.indexOf(":");
    if (separator < 0) continue;
    const key = line.slice(0, separator).trim();
    const raw = line.slice(separator + 1).trim();
    try { result[key] = JSON.parse(raw); } catch { result[key] = raw; }
  }
  return result;
}

function fakeApp(cacheEnabled = true, blockedFolder = ""): {
  app: App;
  textFiles: Map<string, string>;
  frontmatter: Map<string, Record<string, unknown>>;
  setProcessInterleave: (callback: ((content: string) => string) | null) => void;
  setFrontmatterFailure: (value: boolean) => void;
} {
  const textFiles = new Map<string, string>();
  const binaryFiles = new Map<string, ArrayBuffer>();
  const folders = new Set<string>();
  const fileObjects = new Map<string, FakeFile>();
  const frontmatter = new Map<string, Record<string, unknown>>();
  let processInterleave: ((content: string) => string) | null = null;
  let frontmatterFailure = false;
  const vault = {
    adapter: {
      exists: async (path: string) => textFiles.has(path) || binaryFiles.has(path) || folders.has(path)
    },
    createFolder: async (path: string) => {
      if (path === blockedFolder) throw new Error("folder blocked");
      folders.add(path);
    },
    create: async (path: string, content: string) => {
      if (textFiles.has(path)) throw new Error("already exists");
      const file = Object.assign(new TFile(), { path, extension: path.split(".").pop() ?? "" });
      textFiles.set(path, content);
      fileObjects.set(path, file);
      frontmatter.set(path, parseFrontmatter(content));
      return file;
    },
    createBinary: async (path: string, content: ArrayBuffer) => {
      binaryFiles.set(path, content);
      const file = Object.assign(new TFile(), { path, extension: path.split(".").pop() ?? "" });
      fileObjects.set(path, file);
      return file;
    },
    modifyBinary: async (file: FakeFile, content: ArrayBuffer) => { binaryFiles.set(file.path, content); },
    getAbstractFileByPath: (path: string) => fileObjects.get(path) ?? null,
    read: async (file: FakeFile) => textFiles.get(file.path) ?? "",
    modify: async (file: FakeFile, content: string) => { textFiles.set(file.path, content); },
    process: async (file: FakeFile, callback: (content: string) => string) => {
      const latest = processInterleave ? processInterleave(textFiles.get(file.path) ?? "") : textFiles.get(file.path) ?? "";
      processInterleave = null;
      textFiles.set(file.path, callback(latest));
    },
    getMarkdownFiles: () => [...fileObjects.values()].filter((file) => file.path.endsWith(".md"))
  };
  const app = {
    vault,
    metadataCache: {
      getFileCache: (file: FakeFile) => cacheEnabled ? { frontmatter: frontmatter.get(file.path) ?? {} } : null
    },
    fileManager: {
      processFrontMatter: async (file: FakeFile, callback: (value: Record<string, unknown>) => void) => {
        if (frontmatterFailure) throw new Error("frontmatter blocked");
        const value = frontmatter.get(file.path) ?? {};
        callback(value);
        frontmatter.set(file.path, value);
      }
    }
  };
  return {
    app: app as unknown as App,
    textFiles,
    frontmatter,
    setProcessInterleave: (callback) => { processInterleave = callback; },
    setFrontmatterFailure: (value) => { frontmatterFailure = value; }
  };
}

class FakeHttp implements HttpGateway {
  binaryCalls = 0;
  postCalls = 0;
  constructor(private readonly binaryError = false) {}
  async getText(): Promise<HttpTextResponse> { throw new Error("not used"); }
  async postJson(): Promise<HttpTextResponse> {
    this.postCalls += 1;
    throw new Error("AI unavailable");
  }
  async getBinary(): Promise<HttpBinaryResponse> {
    this.binaryCalls += 1;
    if (this.binaryError) throw new Error("network image failure");
    return {
      status: 200,
      headers: { "content-type": "image/png" },
      arrayBuffer: new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).buffer
    };
  }
}

EvidenceImportService.pageGapMs = 0;

class CountingPageHttp extends FakeHttp {
  inFlight = 0;
  maxInFlight = 0;
  override async getText(url = ""): Promise<HttpTextResponse> {
    this.inFlight += 1;
    this.maxInFlight = Math.max(this.maxInFlight, this.inFlight);
    await new Promise((resolve) => setTimeout(resolve, 5));
    this.inFlight -= 1;
    const id = url.match(/[0-9a-f]{24}/)?.[0] ?? "67abc1230000000066666666";
    return {
      status: 200,
      headers: { "content-type": "text/html" },
      text: `<script>window.__INITIAL_STATE__={"note":{"noteDetailMap":{"${id}":{"note":{"id":"${id}","title":"标题 ${id.slice(-2)}","desc":"正文","user":{"nickname":"作者"}}}}}};</script>`
    };
  }
}

class SameNoteHttp extends FakeHttp {
  override async getText(): Promise<HttpTextResponse> {
    const id = "67abc1230000000066666666";
    return {
      status: 200,
      headers: { "content-type": "text/html" },
      text: `<script>window.__INITIAL_STATE__={"note":{"noteDetailMap":{"${id}":{"note":{"id":"${id}","title":"同一来源","desc":"正文","user":{"nickname":"作者"}}}}}};</script>`
    };
  }
}

function source(id = "67abc1230000000012345678", withImage = false): EvidenceSource {
  return {
    platform: "xiaohongshu",
    sourceId: id,
    canonicalUrl: `https://www.xiaohongshu.com/explore/${id}`,
    title: "可重复导入的来源",
    author: "作者",
    body: "正文",
    tags: ["测试"],
    sourceKind: withImage ? "image" : "unknown",
    images: withImage ? [{ remoteUrl: "https://sns-webpic-qc.xhscdn.com/a.png" }] : [],
    capturedAt: "2026-08-25T00:00:00.000Z",
    warnings: [],
    extractionMethod: "initial_state"
  };
}

function preview(value: EvidenceSource): PreviewSuccess {
  return {
    kind: "success",
    inputUrl: value.canonicalUrl,
    source: value,
    plannedPath: `Evidence Inbox/小红书/${value.sourceId}.md`
  };
}

describe("page requests", () => {
  it("reads public pages one at a time", async () => {
    const { app } = fakeApp();
    const http = new CountingPageHttp();
    const service = new EvidenceImportService(app, normalizeSettings({}), http);
    const urls = ["01", "02", "03", "04"].map((tail) => `https://www.xiaohongshu.com/explore/67abc12300000000123456${tail}`);
    const previews = await service.preview(urls);
    expect(previews.every((item) => item.kind === "success")).toBe(true);
    expect(http.maxInFlight).toBe(1);
  });
});

describe("batch import transaction", () => {
  it("is idempotent across three imports and preserves user notes", async () => {
    const { app, textFiles } = fakeApp();
    const settings = normalizeSettings({});
    const service = new EvidenceImportService(app, settings, new FakeHttp());
    const item = preview(source());
    const options = { template: "raw" as const, localizeImages: false, generateWithAi: false };

    const first = await service.importPreviews([item], options);
    expect(first.results[0]?.outcome).toBe("created");
    const notePath = first.results[0]?.path;
    expect(notePath).toBeTruthy();
    textFiles.set(notePath!, textFiles.get(notePath!)!.replace("## 我的笔记\n\n", "## 我的笔记\n\n我的判断不会被覆盖。\n"));

    const second = await service.importPreviews([item], options);
    const third = await service.importPreviews([item], options);
    expect(second.results[0]?.outcome).toBe("updated");
    expect(third.results[0]?.outcome).toBe("updated");
    const sourceNotes = [...textFiles.keys()].filter((path) => path.startsWith(settings.captureFolder));
    expect(sourceNotes).toHaveLength(1);
    expect(textFiles.get(notePath!)).toContain("我的判断不会被覆盖。");
  });

  it("preserves a hand-edited knowledge card and user tags on source refresh", async () => {
    const { app, textFiles, frontmatter } = fakeApp();
    const settings = normalizeSettings({});
    const service = new EvidenceImportService(app, settings, new FakeHttp());
    const firstSource = source();
    firstSource.publishedAt = "2026-08-20T00:00:00.000Z";
    const item = preview(firstSource);
    const first = await service.importPreviews(
      [item],
      { template: "creator", localizeImages: false, generateWithAi: false }
    );
    const notePath = first.results[0]?.path ?? "";
    textFiles.set(notePath, (textFiles.get(notePath) ?? "").replace(
      "（待阅读后补充）",
      "我手填的卡片不会丢。"
    ));
    const metadata = frontmatter.get(notePath) ?? {};
    metadata.tags = ["evidence-inbox", "我的标签"];
    metadata.knowledge_template = "creator";
    metadata.ai_status = "disabled";
    frontmatter.set(notePath, metadata);

    const updated = source();
    updated.title = "刷新后的来源标题";
    await service.importPreviews(
      [preview(updated)],
      { template: "raw", localizeImages: false, generateWithAi: false }
    );
    expect(textFiles.get(notePath)).toContain("我手填的卡片不会丢。");
    expect(textFiles.get(notePath)).toContain("刷新后的来源标题");
    expect(frontmatter.get(notePath)?.tags).toEqual(expect.arrayContaining(["我的标签", "evidence-inbox"]));
    expect(frontmatter.get(notePath)?.knowledge_template).toBe("creator");
    expect(frontmatter.get(notePath)?.published_at).toBeUndefined();
  });

  it("finds an existing source even while the metadata cache is unavailable", async () => {
    const { app, textFiles } = fakeApp(false);
    const settings = normalizeSettings({});
    const firstService = new EvidenceImportService(app, settings, new FakeHttp());
    const item = preview(source("67abc1230000000077777777"));
    await firstService.importPreviews([item], { template: "raw", localizeImages: false, generateWithAi: false });
    const reloadedService = new EvidenceImportService(app, settings, new FakeHttp());
    const second = await reloadedService.importPreviews([item], { template: "raw", localizeImages: false, generateWithAi: false });
    expect(second.results[0]?.outcome).toBe("updated");
    expect([...textFiles.keys()].filter((path) => path.startsWith(settings.captureFolder))).toHaveLength(1);
  });

  it("preserves an editor change that lands immediately before the atomic source refresh", async () => {
    const { app, textFiles, setProcessInterleave } = fakeApp();
    const settings = normalizeSettings({});
    const service = new EvidenceImportService(app, settings, new FakeHttp());
    const item = preview(source("67abc1230000000044444444"));
    const first = await service.importPreviews([item], { template: "raw", localizeImages: false, generateWithAi: false });
    const path = first.results[0]?.path ?? "";
    setProcessInterleave((content) => content.replace("## 我的笔记\n\n", "## 我的笔记\n\n刚刚自动保存的文字。\n"));
    await service.importPreviews([item], { template: "raw", localizeImages: false, generateWithAi: false });
    expect(textFiles.get(path)).toContain("刚刚自动保存的文字。");
  });

  it("reports a partial refresh if YAML metadata cannot be updated after the source body", async () => {
    const { app, textFiles, setFrontmatterFailure } = fakeApp();
    const settings = normalizeSettings({});
    const service = new EvidenceImportService(app, settings, new FakeHttp());
    const item = preview(source("67abc1230000000044444445"));
    const first = await service.importPreviews(
      [item],
      { template: "raw", localizeImages: false, generateWithAi: false }
    );
    const path = first.results[0]?.path ?? "";
    item.source.title = "正文已完成刷新";
    setFrontmatterFailure(true);

    const second = await service.importPreviews(
      [item],
      { template: "raw", localizeImages: false, generateWithAi: false }
    );

    expect(second.results[0]?.outcome).toBe("partial");
    expect(second.results[0]?.reason).toContain("YAML");
    expect(textFiles.get(path)).toContain("正文已完成刷新");
  });

  it("marks two different short links that resolve to one note as a batch duplicate", async () => {
    const { app, textFiles } = fakeApp();
    const settings = normalizeSettings({});
    const service = new EvidenceImportService(app, settings, new SameNoteHttp());
    const items = await service.preview([
      "https://xhslink.cn/a/firstCode",
      "https://xhslink.cn/a/secondCode"
    ]);
    expect(items[0]?.kind).toBe("success");
    expect(items[1]?.kind).toBe("success");
    expect(items[1]?.kind === "success" && items[1].batchDuplicate).toBe(true);
    const batch = await service.importPreviews(items, {
      template: "raw",
      localizeImages: false,
      generateWithAi: false
    });
    expect(batch.results.map((result) => result.outcome)).toEqual(["created", "skipped"]);
    expect([...textFiles.keys()].filter((path) => path.startsWith(settings.captureFolder))).toHaveLength(1);
  });

  it("skips an unmanaged same-source conflict before image or AI network work", async () => {
    const { app, textFiles } = fakeApp();
    const id = "67abc1230000000055555555";
    await app.vault.create("existing-user-note.md", `---\nevidence_source_id: "${id}"\n---\n用户原文`);
    const settings = normalizeSettings({ aiEnabled: true, aiModel: "configured-model" });
    const http = new FakeHttp();
    const service = new EvidenceImportService(app, settings, http, "configured-key");
    const batch = await service.importPreviews(
      [preview(source(id, true))],
      { template: "creator", localizeImages: true, generateWithAi: true }
    );
    expect(batch.results[0]?.outcome).toBe("skipped");
    expect(http.binaryCalls).toBe(0);
    expect(http.postCalls).toBe(0);
    expect(textFiles.get("existing-user-note.md")).toContain("用户原文");
  });

  it("continues after a failed item and writes an itemized report", async () => {
    const { app, textFiles } = fakeApp();
    const settings = normalizeSettings({});
    const service = new EvidenceImportService(app, settings, new FakeHttp());
    const failed: PreviewFailure = {
      kind: "failure",
      inputUrl: "https://xhslink.cn/o/profile",
      displayUrl: "https://xhslink.cn/o/profile",
      reason: "不是公开笔记",
      recovery: "请换用公开笔记链接。"
    };
    const batch = await service.importPreviews(
      [failed, preview(source("67abc1230000000099999999"))],
      { template: "raw", localizeImages: false, generateWithAi: false }
    );
    expect(batch.results.map((result) => result.outcome)).toEqual(["failed", "created"]);
    expect(batch.reportPath).toBeTruthy();
    expect(textFiles.get(batch.reportPath!)).toContain("不是公开笔记");
    expect(textFiles.get(batch.reportPath!)).toContain("](</Evidence%20Inbox/");
  });

  it("marks an Open Graph-only archive as partial even when it has body text", async () => {
    const { app } = fakeApp();
    const settings = normalizeSettings({});
    const metadataSource = source("67abc1230000000010101010");
    metadataSource.extractionMethod = "open_graph";
    const batch = await new EvidenceImportService(app, settings, new FakeHttp()).importPreviews(
      [preview(metadataSource)],
      { template: "raw", localizeImages: false, generateWithAi: false }
    );
    expect(batch.results[0]?.outcome).toBe("partial");
  });

  it("saves a partial note when image and AI calls fail", async () => {
    const { app, textFiles } = fakeApp();
    const settings = normalizeSettings({ aiEnabled: false });
    const service = new EvidenceImportService(app, settings, new FakeHttp(true));
    const batch = await service.importPreviews(
      [preview(source("67abc1230000000088888888", true))],
      { template: "creator", localizeImages: true, generateWithAi: true }
    );
    expect(batch.results[0]?.outcome).toBe("partial");
    const note = textFiles.get(batch.results[0]?.path ?? "") ?? "";
    expect(note).toContain("network image failure");
    expect(note).toContain("AI 尚未完成配置");
    expect(note).toContain("## 我的笔记");
  });

  it("still archives the source when the media folder cannot be created", async () => {
    const { app, textFiles } = fakeApp(true, "Evidence Inbox/Assets");
    const settings = normalizeSettings({});
    const service = new EvidenceImportService(app, settings, new FakeHttp());
    const batch = await service.importPreviews(
      [preview(source("67abc1230000000033333333", true))],
      { template: "raw", localizeImages: true, generateWithAi: false }
    );
    expect(batch.results[0]?.outcome).toBe("partial");
    expect(textFiles.get(batch.results[0]?.path ?? "")).toContain("图片目录不可用");
  });

  it("preserves an existing local image reference when refresh localization is off", async () => {
    const { app, textFiles } = fakeApp();
    const settings = normalizeSettings({});
    const service = new EvidenceImportService(app, settings, new FakeHttp());
    const item = preview(source("67abc1230000000022222222", true));
    const first = await service.importPreviews(
      [item],
      { template: "raw", localizeImages: true, generateWithAi: false }
    );
    const path = first.results[0]?.path ?? "";
    expect(textFiles.get(path)).toContain("![[Evidence Inbox/Assets/67abc1230000000022222222-01.png]]");
    await service.importPreviews(
      [item],
      { template: "raw", localizeImages: false, generateWithAi: false }
    );
    expect(textFiles.get(path)).toContain("![[Evidence Inbox/Assets/67abc1230000000022222222-01.png]]");
  });

  it("stops before the next item when the active import is cancelled", async () => {
    const { app, textFiles } = fakeApp();
    const settings = normalizeSettings({});
    const controller = new AbortController();
    const service = new EvidenceImportService(app, settings, new FakeHttp(), "", controller.signal);
    const operation = service.importPreviews(
      [
        preview(source("67abc1230000000011111111")),
        preview(source("67abc1230000000011111112"))
      ],
      { template: "raw", localizeImages: false, generateWithAi: false },
      (progress) => {
        if (progress.completed === 1) controller.abort();
      }
    );
    await expect(operation).rejects.toThrow("操作已取消");
    expect([...textFiles.keys()].filter((path) => path.startsWith(settings.captureFolder))).toHaveLength(1);
  });
});
