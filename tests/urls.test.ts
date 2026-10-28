import { describe, expect, it } from "vitest";
import { canonicalXhsUrl, extractNoteIdFromUrl, extractShareUrls } from "../src/core/urls";

describe("share URL parsing", () => {
  it("extracts current and legacy Xiaohongshu share formats", () => {
    const input = [
      "看看这个 https://xhslink.cn/o/4HSMP0SB014。",
      "https://www.xiaohongshu.com/explore/67abc1230000000012345678?xsec_token=secret",
      "https://xhslink.com/a/oldCode123,"
    ].join("\n");
    expect(extractShareUrls(input).urls).toEqual([
      "https://xhslink.cn/o/4HSMP0SB014",
      "https://www.xiaohongshu.com/explore/67abc1230000000012345678?xsec_token=secret",
      "https://xhslink.com/a/oldCode123"
    ]);
  });

  it("accepts RedNote domains, xhs.cn short links, and notes opened from profile or search pages", () => {
    const parsed = extractShareUrls([
      "https://www.rednote.com/explore/67abc1230000000012345671?xsec_token=t",
      "http://xhs.cn/AbCdEf12",
      "https://www.xiaohongshu.com/user/profile/5a1b2c3d4e5f/67abc1230000000012345672?xsec_token=t",
      "https://www.xiaohongshu.com/search_result/67abc1230000000012345673"
    ].join("\n"));
    expect(parsed.rejected).toEqual([]);
    expect(parsed.urls).toEqual([
      "https://www.rednote.com/explore/67abc1230000000012345671?xsec_token=t",
      "https://xhs.cn/AbCdEf12",
      "https://www.xiaohongshu.com/explore/67abc1230000000012345672?xsec_token=t",
      "https://www.xiaohongshu.com/explore/67abc1230000000012345673"
    ]);
  });

  it("does not rewrite profile pages that are not a note", () => {
    const parsed = extractShareUrls("https://www.xiaohongshu.com/user/profile/5a1b2c3d4e5f");
    expect(parsed.urls).toEqual([]);
  });

  it("upgrades http share links to https", () => {
    const parsed = extractShareUrls("复制本条信息 http://xhslink.com/a/oldCode456，打开【小红书】App查看");
    expect(parsed.urls).toEqual(["https://xhslink.com/a/oldCode456"]);
    expect(parsed.rejected).toEqual([]);
  });

  it("deduplicates direct links by note ID without retaining extra copies", () => {
    const parsed = extractShareUrls([
      "https://www.xiaohongshu.com/explore/67abc1230000000012345678?a=1",
      "https://www.xiaohongshu.com/discovery/item/67abc1230000000012345678?b=2"
    ].join("\n"));
    expect(parsed.urls).toHaveLength(1);
  });

  it("preserves case-sensitive short-link codes during deduplication", () => {
    const parsed = extractShareUrls([
      "https://xhslink.cn/o/AbC123",
      "https://xhslink.cn/o/aBc123"
    ].join("\n"));
    expect(parsed.urls).toHaveLength(2);
  });

  it("rejects lookalike hosts and enforces the batch cap", () => {
    const links = Array.from({ length: 12 }, (_, index) => `https://xhslink.cn/a/code${index}`).join("\n");
    const parsed = extractShareUrls(`${links}\nhttps://xiaohongshu.com.evil.test/explore/abc12345`, 10);
    expect(parsed.urls).toHaveLength(10);
    expect(parsed.rejected).toContain("https://xiaohongshu.com.evil.test/explore/abc12345");
    expect(parsed.truncated).toBe(true);
  });

  it("extracts and canonicalizes note IDs", () => {
    const id = "67abc1230000000012345678";
    expect(extractNoteIdFromUrl(`https://www.xiaohongshu.com/discovery/item/${id}?token=x`)).toBe(id);
    expect(canonicalXhsUrl(id)).toBe(`https://www.xiaohongshu.com/explore/${id}`);
  });
});
