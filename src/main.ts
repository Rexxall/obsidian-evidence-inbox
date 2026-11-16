import { Notice, Plugin } from "obsidian";
import { normalizeSettings, type EvidenceInboxSettings } from "./settings";
import { ObsidianHttpGateway } from "./network/http";
import { EvidenceImportModal } from "./ui/import-modal";
import { EvidenceInboxOnboardingModal } from "./ui/onboarding-modal";
import { EvidenceInboxSettingTab } from "./ui/settings-tab";
import { decorateNoteZones } from "./ui/note-zones";
import { createAiClient } from "./ai/kit";
import { migrateAiSettings } from "./ai/migrate";
import { aiIsConfigured } from "./settings";
import type { AiClient } from "./vendor/rex-ai-kit/index";

export default class EvidenceInboxPlugin extends Plugin {
  declare settings: EvidenceInboxSettings;
  ai!: AiClient;
  readonly http = new ObsidianHttpGateway();
  private importModal: EvidenceImportModal | null = null;

  async onload(): Promise<void> {
    const loaded: unknown = await this.loadData();
    this.settings = normalizeSettings(loaded, this.app.vault.configDir);
    // Address, model and key name from 0.3.x and earlier become one AI slot; the old key keeps being read.
    const { ai, changed } = migrateAiSettings(loaded, this.app.secretStorage);
    this.settings.ai = ai;
    // No network here: the client only sends requests from Check, Refresh or an import.
    this.ai = createAiClient(this.app.secretStorage, this.settings.modelCache);
    if (loaded && changed) await this.saveSettings();
    this.addSettingTab(new EvidenceInboxSettingTab(this.app, this));
    this.registerMarkdownPostProcessor((element, context) => decorateNoteZones(element, context));
    this.addRibbonIcon("inbox", "导入小红书笔记", () => this.openImportModal());
    this.addCommand({
      id: "import-xhs-links",
      name: "导入小红书公开链接",
      callback: () => this.openImportModal()
    });
    this.addCommand({
      id: "quick-start",
      name: "打开快速开始说明",
      callback: () => this.openOnboarding()
    });
    // obsidian://evidence-inbox?url=… opens the import window with the link filled in; nothing is fetched until Preview.
    this.registerObsidianProtocolHandler("evidence-inbox", (params) => {
      const text = [params.url, params.text].filter((value): value is string => typeof value === "string" && value.length > 0).join("\n");
      this.openImportModal(text);
    });
    if (!this.settings.hasSeenOnboarding && typeof window !== "undefined") {
      const timeout = window.setTimeout(() => this.openOnboarding(), 700);
      this.register(() => window.clearTimeout(timeout));
    }
  }

  async saveSettings(): Promise<void> {
    if (this.ai) this.settings.modelCache = this.ai.cache.toJSON();
    await this.saveData(this.settings);
  }

  onunload(): void {
    this.importModal?.cancelAndClose();
    this.importModal = null;
  }

  openImportModal(initialText = ""): void {
    if (this.importModal) {
      if (initialText && this.importModal.appendInput(initialText)) return;
      new Notice("导入窗口已经开着，请先完成当前操作。");
      return;
    }
    this.importModal = new EvidenceImportModal(this.app, this, initialText);
    this.importModal.open();
  }

  releaseImportModal(modal: EvidenceImportModal): void {
    if (this.importModal === modal) this.importModal = null;
  }

  openOnboarding(): void {
    new EvidenceInboxOnboardingModal(this.app, this).open();
  }

  /** AI is on and the chosen service has what it needs to be called. */
  aiReady(): boolean {
    return aiIsConfigured(this.settings, this.ai);
  }
}
