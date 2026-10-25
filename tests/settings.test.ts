import { describe, expect, it } from "vitest";
import { aiIsConfigured, DEFAULT_SETTINGS, normalizeSettings } from "../src/settings";

describe("settings normalization", () => {
  it("repairs unsafe folders and caps the batch size", () => {
    const settings = normalizeSettings({ captureFolder: "../escape", mediaFolder: ".obsidian/plugins", maxBatchSize: 99 });
    expect(settings.captureFolder).toBe("Evidence Inbox/小红书");
    expect(settings.mediaFolder).toBe("Evidence Inbox/Assets");
    expect(settings.maxBatchSize).toBe(10);
  });

  it("requires explicit AI enablement, key, base URL and model", () => {
    const settings = normalizeSettings({
      aiEnabled: true,
      aiBaseUrl: "https://api.example.test/v1",
      aiModel: "model-id"
    });
    expect(aiIsConfigured(settings, "secret")).toBe(true);
    expect(aiIsConfigured(settings, "")).toBe(false);
  });

  it("never persists AI endpoint credentials, queries, or fragments", () => {
    const settings = normalizeSettings({
      aiBaseUrl: "https://user:secret@provider.example/v1?api_key=private#fragment"
    });
    expect(settings.aiBaseUrl).toBe("https://provider.example/v1");
    expect(JSON.stringify(settings)).not.toContain("secret");
    expect(JSON.stringify(settings)).not.toContain("api_key");
  });

  it("does not silently redirect an invalid provider URL to the default service", () => {
    const settings = normalizeSettings({
      aiEnabled: true,
      aiBaseUrl: "http://10.0.0.4/v1",
      aiModel: "provider-model"
    });
    expect(settings.aiBaseUrl).toBe("");
    expect(aiIsConfigured(settings, "provider-key")).toBe(false);
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
