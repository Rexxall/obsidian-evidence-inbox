import { describe, expect, it } from "vitest";
import { DEFAULT_AI, LEGACY_SECRET_NAME, migrateAiSettings } from "../src/ai/migrate";

/** Obsidian's Keychain as a map. */
function keychain(entries: Record<string, string> = {}) {
  const map = new Map(Object.entries(entries));
  return {
    map,
    getSecret: (id: string) => map.get(id) ?? null,
    setSecret: (id: string, secret: string) => { map.set(id, secret); }
  };
}

/** What 0.3.0 wrote to data.json, AI part only. */
function old(fields: Record<string, unknown> = {}): Record<string, unknown> {
  return { captureFolder: "Evidence Inbox/小红书", aiEnabled: false, aiBaseUrl: "https://api.openai.com/v1", aiModel: "", userContext: "", ...fields };
}

describe("AI settings migration", () => {
  it("starts a fresh install on the default slot without asking to save", () => {
    expect(migrateAiSettings(null, keychain())).toEqual({ ai: DEFAULT_AI, changed: false });
  });

  it("gives a 0.3.0 setup that never configured AI the default slot and saves once", () => {
    const { ai, changed } = migrateAiSettings(old(), keychain());
    expect(ai).toEqual({ provider: "openai", model: "gpt-6-luna" });
    expect(changed).toBe(true);
  });

  it("keeps the old Keychain name when it holds a key, with the provider from the address", () => {
    const store = keychain({ [LEGACY_SECRET_NAME]: "sk-old" });
    const { ai, changed } = migrateAiSettings(old({ aiEnabled: true, aiBaseUrl: "https://api.deepseek.com/v1", aiModel: "deepseek-chat" }), store);
    expect(ai).toEqual({ provider: "deepseek", model: "deepseek-chat", secretName: LEGACY_SECRET_NAME });
    expect(changed).toBe(true);
    expect(store.map.get(LEGACY_SECRET_NAME)).toBe("sk-old");
  });

  it("keeps the old Keychain name on the stock OpenAI address with only a key set", () => {
    const { ai } = migrateAiSettings(old(), keychain({ [LEGACY_SECRET_NAME]: "sk-old" }));
    expect(ai).toEqual({ provider: "openai", model: "gpt-6-luna", secretName: LEGACY_SECRET_NAME });
  });

  it("drops an empty old Keychain name when the shared name holds a key", () => {
    const store = keychain({ [LEGACY_SECRET_NAME]: "", "openai-api-key": "sk-shared" });
    const { ai } = migrateAiSettings(old({ aiModel: "gpt-6.1-terra" }), store);
    expect(ai).toEqual({ provider: "openai", model: "gpt-6.1-terra" });
  });

  it("keeps an empty old Keychain name when the shared name is empty too, for a key on another device", () => {
    const { ai } = migrateAiSettings(old({ aiModel: "gpt-6.1-terra" }), keychain());
    expect(ai.secretName).toBe(LEGACY_SECRET_NAME);
  });

  it("moves a plain-text key into the Keychain and leaves none in the data", () => {
    const store = keychain();
    const saved = old({ aiModel: "gpt-6-luna", aiApiKey: "sk-plain" });
    const { ai, changed } = migrateAiSettings(saved, store);
    expect(store.map.get("openai-api-key")).toBe("sk-plain");
    expect(ai).toEqual({ provider: "openai", model: "gpt-6-luna" });
    expect(JSON.stringify(ai)).not.toContain("sk-plain");
    expect(changed).toBe(true);
  });

  it("stores a plain-text key under the plugin's own name when another plugin's key holds the shared one", () => {
    const store = keychain({ "openai-api-key": "sk-other-plugin" });
    const { ai } = migrateAiSettings(old({ aiModel: "gpt-6-luna", aiApiKey: "sk-plain" }), store);
    expect(store.map.get("openai-api-key")).toBe("sk-other-plugin");
    expect(ai.secretName).toBe("evidence-inbox-openai-api-key");
    expect(store.map.get("evidence-inbox-openai-api-key")).toBe("sk-plain");
  });

  it("does not send an unsafe old address to the default service", () => {
    const { ai } = migrateAiSettings(old({ aiEnabled: true, aiBaseUrl: "http://10.0.0.4/v1", aiModel: "local-model" }), keychain({ [LEGACY_SECRET_NAME]: "k" }));
    expect(ai.provider).toBe("custom");
    expect(ai.baseUrl).toBeUndefined();
  });

  it("strips credentials and queries from an old custom address", () => {
    const { ai } = migrateAiSettings(old({ aiBaseUrl: "https://user:pw@proxy.example/v1?api_key=x#f", aiModel: "m" }), keychain());
    expect(ai).toMatchObject({ provider: "custom", model: "m", baseUrl: "https://proxy.example/v1" });
    expect(JSON.stringify(ai)).not.toContain("pw");
  });

  it("leaves already-migrated data unchanged", () => {
    const saved = { aiEnabled: true, ai: { provider: "anthropic", model: "claude-haiku-5-5", secretName: "my-claude-key" } };
    const store = keychain({ "my-claude-key": "sk-ant" });
    const { ai, changed } = migrateAiSettings(saved, store);
    expect(ai).toEqual(saved.ai);
    expect(changed).toBe(false);
    expect(store.map.size).toBe(1);
  });
});
