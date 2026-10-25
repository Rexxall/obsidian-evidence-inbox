import { Notice, Plugin } from "obsidian";
import { normalizeSettings, type EvidenceInboxSettings } from "./settings";
import { ObsidianHttpGateway } from "./network/http";
import { EvidenceImportModal } from "./ui/import-modal";
import { EvidenceInboxOnboardingModal } from "./ui/onboarding-modal";
import { EvidenceInboxSettingTab } from "./ui/settings-tab";
import { decorateNoteZones } from "./ui/note-zones";

export default class EvidenceInboxPlugin extends Plugin {
  private static readonly AI_SECRET_ID = "evidence-inbox-ai-key";
  declare settings: EvidenceInboxSettings;
  readonly http = new ObsidianHttpGateway();
  private importModal: EvidenceImportModal | null = null;

  async onload(): Promise<void> {
    const loaded = await this.loadData() as (Partial<EvidenceInboxSettings> & { aiApiKey?: unknown }) | null;
    const hadLegacyKeyField = Boolean(loaded && "aiApiKey" in loaded);
    const legacyKey = typeof loaded?.aiApiKey === "string" ? loaded.aiApiKey.trim() : "";
    if (legacyKey) this.app.secretStorage.setSecret(EvidenceInboxPlugin.AI_SECRET_ID, legacyKey);
    if (loaded && "aiApiKey" in loaded) delete loaded.aiApiKey;
    this.settings = normalizeSettings(loaded);
    const sanitizedAiEndpoint = Boolean(
      loaded && typeof loaded.aiBaseUrl === "string" && loaded.aiBaseUrl !== this.settings.aiBaseUrl
    );
    if (hadLegacyKeyField || sanitizedAiEndpoint) await this.saveSettings();
    this.addSettingTab(new EvidenceInboxSettingTab(this.app, this));
    this.registerMarkdownPostProcessor((element, context) => decorateNoteZones(element, context));
    this.applyPaperStyle();
    this.register(() => document.body.removeClass("evidence-inbox-paper"));
    this.addRibbonIcon("inbox", "导入到 Evidence Inbox", () => this.openImportModal());
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
    if (!this.settings.hasSeenOnboarding && typeof window !== "undefined") {
      const timeout = window.setTimeout(() => this.openOnboarding(), 700);
      this.register(() => window.clearTimeout(timeout));
    }
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }

  onunload(): void {
    this.importModal?.cancelAndClose();
    this.importModal = null;
  }

  openImportModal(): void {
    if (this.importModal) {
      new Notice("已有一个 Evidence Inbox 导入窗口，请先完成当前操作。");
      return;
    }
    this.importModal = new EvidenceImportModal(this.app, this);
    this.importModal.open();
  }

  releaseImportModal(modal: EvidenceImportModal): void {
    if (this.importModal === modal) this.importModal = null;
  }

  /** Note zones live outside the plugin's own windows, so the paper style is switched on the body. */
  applyPaperStyle(): void {
    document.body.toggleClass("evidence-inbox-paper", this.settings.paperStyle);
  }

  openOnboarding(): void {
    new EvidenceInboxOnboardingModal(this.app, this).open();
  }

  getAiApiKey(): string {
    return this.app.secretStorage.getSecret(EvidenceInboxPlugin.AI_SECRET_ID) ?? "";
  }

  hasAiApiKey(): boolean {
    return Boolean(this.getAiApiKey());
  }

  setAiApiKey(value: string): void {
    this.app.secretStorage.setSecret(EvidenceInboxPlugin.AI_SECRET_ID, value.trim());
  }
}
