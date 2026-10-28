import { describe, expect, it } from "vitest";
import { folderOf, mediaExtension, normalizeVaultFolder, stableNoteFilename } from "../src/core/paths";

describe("vault paths", () => {
  it("rejects traversal and Obsidian configuration destinations", () => {
    expect(normalizeVaultFolder("../outside", "Evidence Inbox")).toBe("Evidence Inbox");
    expect(normalizeVaultFolder(".obsidian_mac/plugins", "Evidence Inbox")).toBe("Evidence Inbox");
    expect(normalizeVaultFolder("Evidence Inbox/bad]]name", "fallback")).toBe("fallback");
    expect(normalizeVaultFolder("Evidence Inbox/bad\nname", "fallback")).toBe("fallback");
    expect(normalizeVaultFolder("Evidence Inbox/小红书", "fallback")).toBe("Evidence Inbox/小红书");
  });

  it("always retains the source ID suffix after long titles", () => {
    const idA = "67abc1230000000012345678";
    const idB = "67abc1230000000087654321";
    const title = "非常长的标题".repeat(40);
    expect(stableNoteFilename(title, idA)).toMatch(new RegExp(`--${idA}\\.md$`));
    expect(stableNoteFilename(title, idB)).not.toBe(stableNoteFilename(title, idA));
    expect(stableNoteFilename("标题 #标签 ]] ^block", idA)).not.toMatch(/[#[\]^]/u);
  });

  it("normalizes supported media extensions", () => {
    expect(mediaExtension("image/jpeg; charset=binary", "https://x/a")).toBe("jpg");
    expect(mediaExtension("", "https://x/a.JPEG")).toBe("jpg");
    expect(mediaExtension("text/html", "https://x/a.exe")).toBe("jpg");
  });

  it("also refuses a custom config folder", () => {
    expect(normalizeVaultFolder(".config-vault/x", "fallback", ".config-vault")).toBe("fallback");
    expect(normalizeVaultFolder("notes/x", "fallback", ".config-vault")).toBe("notes/x");
  });

  it("names the destination folder in a few words", () => {
    expect(folderOf("Evidence Inbox/小红书/2026-10 某条笔记.md")).toBe("小红书/");
    expect(folderOf("a/b/c/d.md")).toBe("c/");
    expect(folderOf("note.md")).toBe("库根目录");
  });
});
