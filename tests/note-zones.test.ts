import { describe, expect, it } from "vitest";
import { zoneAt } from "../src/ui/note-zones";
import { KNOWLEDGE_END, KNOWLEDGE_START, MANAGED_END, MANAGED_START, USER_END, USER_START } from "../src/core/markdown";

const lines = [
  "---", "evidence_inbox_version: \"1\"", "---",
  MANAGED_START, "# 标题", "", "正文", MANAGED_END,
  "",
  KNOWLEDGE_START, "## 日本行动卡", "内容", KNOWLEDGE_END,
  USER_START, "## 我的笔记", USER_END,
  "尾部"
];

describe("zoneAt", () => {
  it("returns no zone before the first marker", () => {
    expect(zoneAt(lines, 1)).toBeNull();
  });

  it("marks only the first block after a start marker as first", () => {
    expect(zoneAt(lines, 4)).toEqual({ zone: "source", first: true });
    expect(zoneAt(lines, 6)).toEqual({ zone: "source", first: false });
    expect(zoneAt(lines, 10)).toEqual({ zone: "knowledge", first: true });
    expect(zoneAt(lines, 11)).toEqual({ zone: "knowledge", first: false });
    expect(zoneAt(lines, 14)).toEqual({ zone: "user", first: true });
  });

  it("returns no zone after an end marker", () => {
    expect(zoneAt(lines, 8)).toBeNull();
    expect(zoneAt(lines, 16)).toBeNull();
  });
});
