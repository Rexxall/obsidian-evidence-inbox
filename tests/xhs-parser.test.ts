import { describe, expect, it } from "vitest";
import {
  extractInitialState,
  normalizeInitialStateJson,
  parseXhsPage,
  UnsupportedXhsPageError
} from "../src/core/xhs-parser";

const NOTE_ID = "67abc1230000000012345678";

function statePage(): string {
  return `<!doctype html><html><head><title>fallback - 小红书</title></head><body>
  <script>window.__INITIAL_STATE__={"note":{"noteDetailMap":{"${NOTE_ID}":{"note":{"id":"${NOTE_ID}","title":"测试 undefined 标题","desc":"第一行\\n第二行 #医学 #AI","user":{"nickname":"作者A"},"tagList":[{"name":"研究"}],"imageList":[{"urlDefault":"https://sns-webpic-qc.xhscdn.com/a.jpg"},{"urlDefault":"https://evil.test/b.jpg"}],"time":1700000000000,"type":"normal","optional":undefined}}}},"literal":"undefined"};</script>
  </body></html>`;
}

describe("public XHS page parser", () => {
  it("replaces only unquoted undefined tokens", () => {
    const normalized = normalizeInitialStateJson('{"literal":"undefined","value":undefined}');
    expect(JSON.parse(normalized)).toEqual({ literal: "undefined", value: null });
  });

  it("extracts a normalized evidence source from initial state", () => {
    const source = parseXhsPage(statePage(), {
      requestedUrl: `https://www.xiaohongshu.com/explore/${NOTE_ID}`,
      capturedAt: "2026-08-25T00:00:00.000Z"
    });
    expect(source.sourceId).toBe(NOTE_ID);
    expect(source.title).toBe("测试 undefined 标题");
    expect(source.author).toBe("作者A");
    expect(source.body).toContain("第二行");
    expect(source.tags).toEqual(expect.arrayContaining(["研究", "医学", "AI"]));
    expect(source.images).toEqual([{ remoteUrl: "https://sns-webpic-qc.xhscdn.com/a.jpg" }]);
    expect(source.canonicalUrl).not.toContain("?");
    expect(source.publishedAt).toBe("2023-11-14T22:13:20.000Z");
    expect(source.extractionMethod).toBe("initial_state");
  });

  it("supports direct public-note metadata fallback", () => {
    const html = `<meta property='og:url' content='https://www.xiaohongshu.com/explore/${NOTE_ID}'>
      <meta property='og:title' content='备用 &amp; 标题'>
      <meta property='og:description' content='公开正文'>
      <meta property='og:image' content='https://sns-webpic-qc.xhscdn.com/fallback.webp'>`;
    const source = parseXhsPage(html, { requestedUrl: `https://www.xiaohongshu.com/explore/${NOTE_ID}` });
    expect(source.title).toBe("备用 & 标题");
    expect(source.body).toBe("公开正文");
    expect(source.images).toHaveLength(1);
    expect(source.extractionMethod).toBe("open_graph");
    expect(source.warnings).toContain("仅提取到公开 Open Graph 元数据，正文可能被截断。");
  });

  it("allows a normal Open Graph fallback page that also renders a login button", () => {
    const html = `<meta property='og:url' content='https://www.xiaohongshu.com/explore/${NOTE_ID}'>
      <meta property='og:title' content='正常公开笔记'>
      <meta property='og:description' content='公开正文'>
      <button class='login-button'>登录</button>`;
    expect(parseXhsPage(html, { requestedUrl: `https://www.xiaohongshu.com/explore/${NOTE_ID}` }).title)
      .toBe("正常公开笔记");
  });

  it("rejects profiles and unsupported pages honestly", () => {
    expect(() => parseXhsPage("<html><title>主页</title></html>", {
      requestedUrl: "https://xhslink.cn/o/profileCode"
    })).toThrow(UnsupportedXhsPageError);
  });

  it("rejects challenge or generic HTML even when the requested URL contains an ID", () => {
    expect(() => parseXhsPage("<html><title>安全验证 - 小红书</title></html>", {
      requestedUrl: `https://www.xiaohongshu.com/explore/${NOTE_ID}`
    })).toThrow(UnsupportedXhsPageError);
    expect(() => parseXhsPage("<meta property='og:title' content='小红书'>", {
      requestedUrl: `https://www.xiaohongshu.com/explore/${NOTE_ID}`
    })).toThrow(UnsupportedXhsPageError);
  });

  it("never falls back to a different state entry for a direct note URL", () => {
    const otherId = "67abc1230000000099999999";
    const html = `<script>window.__INITIAL_STATE__={"note":{"noteDetailMap":{"${otherId}":{"note":{"id":"${otherId}","title":"别的笔记","desc":"不应导入"}}}}};</script>`;
    expect(() => parseXhsPage(html, {
      requestedUrl: `https://www.xiaohongshu.com/explore/${NOTE_ID}`
    })).toThrow(UnsupportedXhsPageError);
  });

  it("rejects mismatched IDs inside the selected state entry", () => {
    const otherId = "67abc1230000000099999999";
    const html = `<script>window.__INITIAL_STATE__={"note":{"noteDetailMap":{"${NOTE_ID}":{"note":{"id":"${otherId}","title":"冲突","desc":"不应导入"}}}}};</script>`;
    expect(() => parseXhsPage(html, {
      requestedUrl: `https://www.xiaohongshu.com/explore/${NOTE_ID}`
    })).toThrow(UnsupportedXhsPageError);
  });

  it("rejects a state and Open Graph ID disagreement", () => {
    const otherId = "67abc1230000000099999999";
    const html = `<meta property='og:url' content='https://www.xiaohongshu.com/explore/${otherId}'>${statePage()}`;
    expect(() => parseXhsPage(html, {
      requestedUrl: `https://www.xiaohongshu.com/explore/${NOTE_ID}`
    })).toThrow(UnsupportedXhsPageError);
  });

  it("does not reject a verified post merely because its content discusses login errors", () => {
    const html = statePage().replace("第一行\\n第二行 #医学 #AI", "请登录、not found 与安全验证是本文讨论的词");
    const source = parseXhsPage(html, { requestedUrl: `https://www.xiaohongshu.com/explore/${NOTE_ID}` });
    expect(source.body).toContain("请登录");
  });

  it("canonicalizes hexadecimal IDs and caps untrusted tag lengths", () => {
    const upperId = NOTE_ID.toUpperCase();
    const longTag = "标".repeat(200);
    const html = `<script>window.__INITIAL_STATE__={"note":{"noteDetailMap":{"${upperId}":{"note":{"id":"${NOTE_ID.toLowerCase()}","title":"边界测试","desc":"正文","tagList":[{"name":"${longTag}"}]}}}}};</script>`;
    const source = parseXhsPage(html, { requestedUrl: `https://www.xiaohongshu.com/explore/${upperId}` });
    expect(source.sourceId).toBe(NOTE_ID.toLowerCase());
    expect([...(source.tags[0] ?? "")]).toHaveLength(50);
  });

  it("rejects oversized embedded note identifiers", () => {
    const oversized = "a".repeat(200);
    const html = `<script>window.__INITIAL_STATE__={"note":{"noteDetailMap":{"${oversized}":{"note":{"id":"${oversized}","title":"异常","desc":"正文"}}}}};</script>`;
    expect(() => parseXhsPage(html, { requestedUrl: "https://xhslink.cn/o/code" }))
      .toThrow(UnsupportedXhsPageError);
  });

  it("returns null instead of evaluating malformed page state", () => {
    expect(extractInitialState("<script>window.__INITIAL_STATE__={bad:alert(1)}</script>")).toBeNull();
  });
});
