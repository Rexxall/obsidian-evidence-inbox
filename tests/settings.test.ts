import { describe, expect, it } from "vitest";
import { aiIsConfigured, DEFAULT_SETTINGS, normalizeSettings } from "../src/settings";
import { DEFAULT_AI } from "../src/ai/migrate";
import { resolveProvider, type AiSlot } from "../src/vendor/rex-ai-kit/index";

describe("settings normalization", () => {
  it("repairs unsafe folders and caps the batch size", () => {
    const settings = normalizeSettings({ captureFolder: "../escape", mediaFolder: ".obsidian/plugins", maxBatchSize: 99 });
    expect(settings.captureFolder).toBe("Evidence Inbox/小红书");
    expect(settings.mediaFolder).toBe("Evidence Inbox/Assets");
    expect(settings.maxBatchSize).toBe(10);
  });

  it("requires AI switched on, a key and a model", () => {
    const client = (hasKey: boolean) => ({ hasKey: () => hasKey, provider: (slot: AiSlot) => resolveProvider(slot) });
    const on = normalizeSettings({ aiEnabled: true });
    expect(aiIsConfigured(on, client(true))).toBe(true);
    expect(aiIsConfigured(on, client(false))).toBe(false);
    expect(aiIsConfigured(on, null)).toBe(false);
    expect(aiIsConfigured(normalizeSettings({ aiEnabled: false }), client(true))).toBe(false);
    expect(aiIsConfigured(normalizeSettings({ aiEnabled: true, ai: { provider: "openai", model: "" } }), client(true))).toBe(false);
    // A custom server with no address cannot be called.
    expect(aiIsConfigured(normalizeSettings({ aiEnabled: true, ai: { provider: "custom", model: "m" } }), client(true))).toBe(false);
  });

  it("starts on the default AI service and drops the old address fields", () => {
    const settings = normalizeSettings({ aiBaseUrl: "https://user:secret@provider.example/v1?api_key=private", aiModel: "m" });
    expect(settings.ai).toEqual(DEFAULT_AI);
    expect(JSON.stringify(settings)).not.toContain("secret");
    expect(JSON.stringify(settings)).not.toContain("aiBaseUrl");
  });

  it("keeps a saved AI slot and model cache", () => {
    const cache = { openai: { at: 1, models: [{ id: "gpt-6-luna" }] } };
    const settings = normalizeSettings({ ai: { provider: "deepseek", model: "deepseek-flash", secretName: "my-key" }, modelCache: cache });
    expect(settings.ai).toEqual({ provider: "deepseek", model: "deepseek-flash", secretName: "my-key" });
    expect(settings.modelCache).toEqual(cache);
  });

  it("repairs malformed persisted value types without blocking plugin load", () => {
    const settings = normalizeSettings({
      captureFolder: 42,
      mediaFolder: { nested: true },
      reportFolder: ["bad"],
      aiEnabled: "yes",
      localizeImagesByDefault: "no",
      hasSeenOnboarding: 1
    });
    expect(settings.captureFolder).toBe(DEFAULT_SETTINGS.captureFolder);
    expect(settings.mediaFolder).toBe(DEFAULT_SETTINGS.mediaFolder);
    expect(settings.reportFolder).toBe(DEFAULT_SETTINGS.reportFolder);
    expect(settings.aiEnabled).toBe(false);
    expect(settings.localizeImagesByDefault).toBe(true);
    expect(settings.hasSeenOnboarding).toBe(false);
  });
});
