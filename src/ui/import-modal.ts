import { App, Modal, Notice, Setting, TFile } from "obsidian";
import type EvidenceInboxPlugin from "../main";
import type { ImportOptions, ImportResult, KnowledgeTemplateId, PreviewItem } from "../types";
import { KNOWLEDGE_TEMPLATES } from "../core/knowledge-templates";
import { extractShareUrls } from "../core/urls";
import { aiIsConfigured } from "../settings";
import { sanitizeDiagnostic } from "../core/security";
import { EvidenceImportService, type BatchImportResult } from "../import/import-service";

const OUTCOME_LABELS: Record<ImportResult["outcome"], string> = {
  created: "已新建",
  updated: "已更新",
  partial: "部分完成",
  skipped: "已跳过",
  failed: "失败"
};

export class EvidenceImportModal extends Modal {
  private inputText = "";
  private previews: PreviewItem[] = [];
  private selected = new Set<number>();
  private template: KnowledgeTemplateId;
  private localizeImages: boolean;
  private generateWithAi = false;
  private busy = false;
  private disposed = false;
  private controller: AbortController | null = null;

  constructor(app: App, private readonly owner: EvidenceInboxPlugin) {
    super(app);
    this.template = owner.settings.defaultTemplate;
    this.localizeImages = owner.settings.localizeImagesByDefault;
  }

  onOpen(): void {
    this.disposed = false;
    this.modalEl.addClass("evidence-inbox-modal");
    this.renderInput();
  }

  onClose(): void {
    this.disposed = true;
    this.controller?.abort();
    this.controller = null;
    this.contentEl.empty();
    this.owner.releaseImportModal(this);
  }

  close(): void {
    if (this.busy) {
      new Notice("当前操作仍在进行；完成后即可关闭窗口。");
      return;
    }
    super.close();
  }

  cancelAndClose(): void {
    this.controller?.abort();
    this.busy = false;
    super.close();
  }

  private renderInput(): void {
    this.titleEl.setText("导入小红书公开笔记");
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("p", { text: "粘贴分享文本或 1–10 条链接。预览阶段不会写入 Vault。" });
    const textarea = contentEl.createEl("textarea", {
      cls: "evidence-inbox-input",
      attr: { rows: "9", placeholder: "粘贴小红书分享文本或链接，每行一条……" }
    });
    textarea.value = this.inputText;
    textarea.addEventListener("input", () => { this.inputText = textarea.value; });
    const actions = contentEl.createDiv({ cls: "evidence-inbox-actions" });
    const quickStart = actions.createEl("button", { text: "使用说明" });
    quickStart.addEventListener("click", () => {
      this.close();
      this.owner.openOnboarding();
    });
    const preview = actions.createEl("button", { text: "预览", cls: "mod-cta" });
    preview.addEventListener("click", () => void this.loadPreview());
  }

  private async loadPreview(): Promise<void> {
    if (this.busy) return;
    const parsed = extractShareUrls(this.inputText, this.owner.settings.maxBatchSize);
    if (parsed.urls.length === 0) {
      new Notice("没有找到受支持的小红书链接。");
      return;
    }
    if (parsed.rejected.length) new Notice(`已忽略 ${parsed.rejected.length} 条非小红书链接。`);
    if (parsed.truncated) new Notice(`本批只预览前 ${this.owner.settings.maxBatchSize} 条唯一链接。`);
    this.busy = true;
    const controller = new AbortController();
    this.controller = controller;
    this.renderProgress("正在读取公开页面", 0, parsed.urls.length);
    const service = new EvidenceImportService(
      this.app,
      this.owner.settings,
      this.owner.http,
      this.owner.getAiApiKey(),
      controller.signal
    );
    try {
      this.previews = await service.preview(parsed.urls, (progress) => {
        this.renderProgress(progress.label, progress.completed, progress.total);
      });
      this.selected.clear();
      this.previews.forEach((item, index) => {
        if (item.kind === "success" && !item.batchDuplicate && !(item.duplicatePath && item.duplicateManaged === false)) {
          this.selected.add(index);
        }
      });
      this.renderPreview();
    } catch (error) {
      if (!this.disposed) {
        new Notice(controller.signal.aborted ? "已取消预览。" : `预览失败：${sanitizeDiagnostic(error)}`);
        this.renderInput();
      }
    } finally {
      if (this.controller === controller) this.controller = null;
      this.busy = false;
    }
  }

  private renderProgress(label: string, completed: number, total: number): void {
    this.titleEl.setText("Evidence Inbox");
    this.contentEl.empty();
    this.contentEl.createEl("h3", { text: label });
    this.contentEl.createEl("progress", {
      cls: "evidence-inbox-progress",
      attr: { max: String(Math.max(total, 1)), value: String(Math.min(completed, total)) }
    });
    this.contentEl.createEl("p", { text: `${completed} / ${total}` });
    if (this.controller && !this.controller.signal.aborted) {
      const cancel = this.contentEl.createEl("button", { text: "取消" });
      cancel.addEventListener("click", () => this.controller?.abort());
    }
  }

  private renderPreview(): void {
    this.titleEl.setText("确认导入");
    const { contentEl } = this;
    contentEl.empty();
    const successes = this.previews.filter((item) => item.kind === "success").length;
    const selectable = this.previews.filter((item) =>
      item.kind === "success" && !item.batchDuplicate && !(item.duplicatePath && item.duplicateManaged === false)
    ).length;
    const failures = this.previews.length - successes;
    contentEl.createEl("p", {
      text: `可选 ${selectable} 条，已排除重复/冲突 ${successes - selectable} 条，无法预览 ${failures} 条。请核对后再写入。`
    });

    new Setting(contentEl)
      .setName("知识卡类型")
      .setDesc("选择“仅原始归档”时不会调用 AI。")
      .addDropdown((dropdown) => {
        for (const template of KNOWLEDGE_TEMPLATES) dropdown.addOption(template.id, template.label);
        dropdown.setValue(this.template).onChange((value) => {
          this.template = value as KnowledgeTemplateId;
          if (this.template === "raw") this.generateWithAi = false;
          this.renderPreview();
        });
      });

    new Setting(contentEl)
      .setName("本地化图片")
      .setDesc("失败时保留远程图片引用，并把该条标为部分完成。")
      .addToggle((toggle) => toggle.setValue(this.localizeImages).onChange((value) => {
        this.localizeImages = value;
      }));

    const aiSetting = new Setting(contentEl)
      .setName("用 AI 生成知识卡")
      .setDesc(aiIsConfigured(this.owner.settings, this.owner.getAiApiKey())
        ? "会把标题、作者、标签、正文和设置中的“我的当前目标”发送到已配置 API；图片不发送。"
        : "需要先在插件设置中启用 AI，并填写 Key、Base URL 与模型。")
      .addToggle((toggle) => toggle
        .setValue(this.generateWithAi)
        .setDisabled(this.template === "raw" || !aiIsConfigured(this.owner.settings, this.owner.getAiApiKey()))
        .onChange((value) => { this.generateWithAi = value; }));
    aiSetting.setDisabled(this.template === "raw");

    const list = contentEl.createDiv({ cls: "evidence-inbox-preview-list" });
    this.previews.forEach((item, index) => this.renderPreviewItem(list, item, index));

    const actions = contentEl.createDiv({ cls: "evidence-inbox-actions" });
    const back = actions.createEl("button", { text: "返回修改" });
    back.addEventListener("click", () => this.renderInput());
    const importButton = actions.createEl("button", {
      text: failures
        ? `导入已选 ${this.selected.size} 条，并记录 ${failures} 条预览失败`
        : `导入已选 ${this.selected.size} 条`,
      cls: "mod-cta"
    });
    importButton.disabled = this.selected.size === 0;
    importButton.addEventListener("click", () => void this.runImport());
  }

  private renderPreviewItem(container: HTMLElement, item: PreviewItem, index: number): void {
    const card = container.createDiv({
      cls: `evidence-inbox-preview-card ${item.kind === "failure" ? "is-failure" : ""}`
    });
    if (item.kind === "failure") {
      card.createEl("strong", { text: "无法预览" });
      card.createEl("code", { text: item.displayUrl });
      card.createEl("p", { text: item.reason });
      card.createEl("p", { cls: "setting-item-description", text: item.recovery });
      return;
    }
    const header = card.createDiv({ cls: "evidence-inbox-preview-header" });
    const checkbox = header.createEl("input", { attr: { type: "checkbox" } });
    checkbox.checked = this.selected.has(index);
    checkbox.disabled = Boolean(item.batchDuplicate || item.duplicatePath && item.duplicateManaged === false);
    checkbox.addEventListener("change", () => {
      if (checkbox.checked) this.selected.add(index); else this.selected.delete(index);
      this.renderPreview();
    });
    header.createEl("strong", { text: item.source.title });
    if (item.batchDuplicate) header.createEl("span", { cls: "evidence-inbox-badge", text: "批内重复，已排除" });
    else if (item.duplicatePath && item.duplicateManaged) header.createEl("span", { cls: "evidence-inbox-badge", text: "将安全更新" });
    else if (item.duplicatePath) header.createEl("span", { cls: "evidence-inbox-badge", text: "同源冲突，已保护" });
    card.createEl("p", { text: `${item.source.author} · ${item.source.images.length} 张图片 · ${item.source.sourceKind}` });
    card.createEl("p", {
      cls: "evidence-inbox-excerpt",
      text: item.source.body.slice(0, 180) || "未提取到正文"
    });
    card.createEl("code", { text: item.plannedPath });
    if (item.duplicatePath && item.duplicateManaged) {
      card.createEl("p", {
        cls: "setting-item-description",
        text: "只刷新来源区；现有知识卡、“我的笔记”和其他用户内容保持原样。知识卡与 AI 选项只对新笔记生效。"
      });
    } else if (item.duplicatePath) {
      card.createEl("p", {
        cls: "setting-item-description",
        text: "该同源文件没有 Evidence Inbox 管理标记，本次不会下载图片、调用 AI 或修改文件。"
      });
    }
  }

  private async runImport(): Promise<void> {
    if (this.busy || this.selected.size === 0) return;
    this.busy = true;
    const controller = new AbortController();
    this.controller = controller;
    const selectedPreviews = this.previews.filter((item, index) => item.kind === "failure" || this.selected.has(index));
    const options: ImportOptions = {
      template: this.template,
      localizeImages: this.localizeImages,
      generateWithAi: this.generateWithAi
    };
    this.renderProgress("正在保存", 0, selectedPreviews.length);
    const service = new EvidenceImportService(
      this.app,
      this.owner.settings,
      this.owner.http,
      this.owner.getAiApiKey(),
      controller.signal
    );
    try {
      const batch = await service.importPreviews(selectedPreviews, options, (progress) => {
        this.renderProgress(progress.label, progress.completed, progress.total);
      });
      this.renderResults(batch);
    } catch (error) {
      if (!this.disposed) {
        new Notice(controller.signal.aborted ? "已取消；已经完成的条目不会回滚。" : `导入未完成：${sanitizeDiagnostic(error)}`);
        this.renderPreview();
      }
    } finally {
      if (this.controller === controller) this.controller = null;
      this.busy = false;
    }
  }

  private renderResults(batch: BatchImportResult): void {
    this.titleEl.setText("导入结果");
    const { contentEl } = this;
    contentEl.empty();
    const summary = new Map<ImportResult["outcome"], number>();
    batch.results.forEach((result) => summary.set(result.outcome, (summary.get(result.outcome) ?? 0) + 1));
    contentEl.createEl("p", {
      text: batch.results.map((result) => result.outcome).filter((value, index, values) => values.indexOf(value) === index)
        .map((outcome) => `${OUTCOME_LABELS[outcome]} ${summary.get(outcome) ?? 0}`).join(" · ")
    });
    const list = contentEl.createDiv({ cls: "evidence-inbox-results" });
    for (const result of batch.results) {
      const row = list.createDiv({ cls: `evidence-inbox-result is-${result.outcome}` });
      row.createEl("strong", { text: `${OUTCOME_LABELS[result.outcome]}：${result.title}` });
      if (result.displayUrl.startsWith("http")) row.createEl("code", { text: result.displayUrl });
      if (result.reason) row.createEl("p", { text: result.reason });
      if (result.warnings.length) row.createEl("p", { cls: "setting-item-description", text: result.warnings.join("；") });
      if (result.path) {
        const open = row.createEl("button", { text: "打开笔记" });
        open.addEventListener("click", () => void this.openPath(result.path!));
      }
    }
    const actions = contentEl.createDiv({ cls: "evidence-inbox-actions" });
    if (batch.reportPath) {
      const report = actions.createEl("button", { text: "打开导入报告" });
      report.addEventListener("click", () => void this.openPath(batch.reportPath!));
    }
    const failedPreviewUrls = this.previews
      .filter((item): item is Extract<PreviewItem, { kind: "failure" }> => item.kind === "failure")
      .map((item) => item.inputUrl);
    const partialOrFailedSourceUrls = batch.results
      .filter((result) => ["failed", "partial"].includes(result.outcome) && result.sourceId)
      .map((result) => {
        const original = this.previews.find((item) =>
          item.kind === "success" && item.source.sourceId === result.sourceId
        );
        return original?.inputUrl ?? result.displayUrl;
      });
    const failedUrls = [...new Set([...failedPreviewUrls, ...partialOrFailedSourceUrls])];
    if (failedUrls.length) {
      const retry = actions.createEl("button", { text: "重试失败项" });
      retry.addEventListener("click", () => {
        this.inputText = failedUrls.join("\n");
        this.renderInput();
      });
    }
    const done = actions.createEl("button", { text: "完成", cls: "mod-cta" });
    done.addEventListener("click", () => this.close());
  }

  private async openPath(path: string): Promise<void> {
    const file = this.app.vault.getAbstractFileByPath(path);
    if (file instanceof TFile) await this.app.workspace.getLeaf(true).openFile(file);
  }
}
