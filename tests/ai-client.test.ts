import { describe, expect, it } from "vitest";
import { parseJsonObject } from "../src/network/ai-client";
import { normalizeKnowledgeCard } from "../src/core/knowledge-templates";

describe("AI response parsing", () => {
  it("accepts a fenced JSON object without trusting extra prose", () => {
    const parsed = parseJsonObject('```json\n{"insight":"核心"}\n```');
    expect(parsed).toEqual({ insight: "核心" });
  });

  it("normalizes missing fields into explicit review placeholders", () => {
    const card = normalizeKnowledgeCard({
      insight: "洞察",
      claims: [{ claim: "论点", evidence: "来源正文" }],
      templateFields: { painPoint: "痛点" }
    }, "creator");
    expect(card.insight).toBe("洞察");
    expect(card.templateFields.find((field) => field.key === "painPoint")?.value).toBe("痛点");
    expect(card.verificationNeeded.length).toBeGreaterThan(0);
  });

  it("rejects non-JSON model output", () => {
    expect(() => parseJsonObject("这里没有 JSON")).toThrow("AI 没有返回 JSON 对象");
  });
});
