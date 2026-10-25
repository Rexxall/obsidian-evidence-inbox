import { describe, expect, it } from "vitest";
import { createPlaceholderCard } from "../src/core/knowledge-templates";
import {
  KNOWLEDGE_END,
  KNOWLEDGE_START,
  MANAGED_START,
  USER_END,
  USER_START,
  mergeManagedBlock,
  renderManagedBlock,
  renderNewNote
} from "../src/core/markdown";
import type { WriteNoteInput } from "../src/types";

function input(title = "原始标题"): WriteNoteInput {
  return {
    source: {
      platform: "xiaohongshu",
      sourceId: "67abc1230000000012345678",
      canonicalUrl: "https://www.xiaohongshu.com/explore/67abc1230000000012345678",
      title,
      author: "作者",
      body: "正文 ![远程追踪](https://evil.test/pixel) \\![预转义追踪](https://evil.test/pixel2) <script>alert(1)</script>\n```dataviewjs\n危险代码\n```",
      tags: ["研究"],
      sourceKind: "image",
      images: [
        { remoteUrl: "https://sns-webpic-qc.xhscdn.com/a.jpg", localPath: "Evidence Inbox/Assets/a.jpg" },
        { remoteUrl: "https://sns-webpic-qc.xhscdn.com/b.jpg?token=private#fragment" },
        { remoteUrl: "https://sns-webpic-qc.xhscdn.com/c.jpg", localPath: "Evidence Inbox/Assets/bad]]\n![[evil" }
      ],
      capturedAt: "2026-08-25T00:00:00.000Z",
      warnings: [],
      extractionMethod: "initial_state"
    },
    knowledgeCard: createPlaceholderCard("creator"),
    template: "creator",
    captureState: "complete",
    mediaState: "complete",
    aiState: "disabled"
  };
}

describe("managed Markdown", () => {
  it("creates distinct managed and user-owned regions", () => {
    const content = renderNewNote(input());
    expect(content).toContain(MANAGED_START);
    expect(content).toContain(KNOWLEDGE_START);
    expect(content).toContain(KNOWLEDGE_END);
    expect(content).toContain(USER_START);
    expect(content).toContain(USER_END);
    expect(content).toContain("evidence_source_id: \"67abc1230000000012345678\"");
    expect(content).toContain("\\!\\[远程追踪\\]");
    expect(content).toContain("&lt;script&gt;");
    expect(content).toContain("https://sns-webpic-qc.xhscdn.com/b.jpg");
    expect(content).not.toContain("token=private");
    const sourceBody = content.split("## 原始内容", 2)[1]?.split("标签：", 1)[0] ?? "";
    expect(sourceBody).not.toMatch(/(^|[^\\])!\[/u);
    expect(sourceBody).not.toContain("```dataviewjs");
    expect(content).not.toContain("]]\n![[evil");
  });

  it("updates only the managed region and preserves user writing", () => {
    const original = renderNewNote(input())
      .replace("## 我的笔记\n\n", "## 我的笔记\n\n这是我写的内容。\n")
      .replace("（待阅读后补充）", "这是我手填的知识卡内容。");
    const nextManaged = renderManagedBlock(input("更新后的标题"));
    const once = mergeManagedBlock(original, nextManaged);
    const twice = mergeManagedBlock(once.content, nextManaged);
    expect(once.replaced).toBe(true);
    expect(twice.content).toContain("这是我写的内容。");
    expect(twice.content).toContain("这是我手填的知识卡内容。");
    expect(twice.content.match(/evidence-inbox:managed:start/g)).toHaveLength(1);
    expect(twice.content).toContain("更新后的标题");
  });

  it("refuses destructive replacement when markers are absent", () => {
    const merged = mergeManagedBlock("---\ntitle: user\n---\n用户自己的笔记", renderManagedBlock(input()));
    expect(merged.replaced).toBe(false);
    expect(merged.content).toContain("用户自己的笔记");
  });
});
