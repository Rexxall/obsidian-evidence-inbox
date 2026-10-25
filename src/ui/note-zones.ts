import type { MarkdownPostProcessorContext } from "obsidian";
import { KNOWLEDGE_END, KNOWLEDGE_START, MANAGED_END, MANAGED_START, USER_END, USER_START } from "../core/markdown";

export type NoteZone = "source" | "knowledge" | "user";

const ZONE_LABELS: Record<NoteZone, { name: string; owner: string }> = {
  source: { name: "来源区", owner: "插件管理，再次导入时刷新" },
  knowledge: { name: "知识卡", owner: "创建后归你，刷新不会覆盖" },
  user: { name: "我的笔记", owner: "永远归你，插件不碰" }
};

const STARTS: Record<string, NoteZone> = { [MANAGED_START]: "source", [KNOWLEDGE_START]: "knowledge", [USER_START]: "user" };
const ENDS = new Set([MANAGED_END, KNOWLEDGE_END, USER_END]);

/**
 * Which zone a line belongs to, and whether it is the first content of that zone.
 * Zones are delimited by the HTML comment markers the plugin writes.
 */
export function zoneAt(lines: string[], line: number): { zone: NoteZone; first: boolean } | null {
  let zone: NoteZone | null = null;
  let first = false;
  for (let index = 0; index < lines.length && index < line; index += 1) {
    const text = lines[index]!.trim();
    if (STARTS[text]) {
      zone = STARTS[text]!;
      first = true;
    } else if (ENDS.has(text)) {
      zone = null;
    } else if (text) {
      first = false;
    }
  }
  return zone ? { zone, first } : null;
}

/** Reading view: mark each block with the zone it belongs to, and label the first block of a zone. */
export function decorateNoteZones(element: HTMLElement, context: MarkdownPostProcessorContext): void {
  if (!context.frontmatter?.evidence_inbox_version) return;
  const info = context.getSectionInfo(element);
  if (!info) return;
  const found = zoneAt(info.text.split("\n"), info.lineStart);
  if (!found) return;
  element.addClass("ei-zone", `ei-zone-${found.zone}`);
  if (!found.first) return;
  const label = ZONE_LABELS[found.zone];
  const tag = createDiv({ cls: "ei-zone-tag" });
  tag.createSpan({ cls: "ei-zone-name", text: label.name });
  tag.createSpan({ cls: "ei-zone-owner", text: label.owner });
  element.prepend(tag);
}
