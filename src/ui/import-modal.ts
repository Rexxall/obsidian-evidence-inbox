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

const OUTCOME_TONES: Record<ImportResult["outcome"], string> = {
  created: "is-good",
  updated: "is-accent",
  partial: "is-warn",
  skipped: "",
  failed: "is-danger"
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
  private progressStep: 2 | 3 = 2;

  private stage: "input" | "other" = "input";

  constructor(app: App, private readonly owner: EvidenceInboxPlugin, initialText = "") {
    super(app);
    this.inputText = initialText.trim();
    this.template = owner.settings.defaultTemplate;
    this.localizeImages = owner.settings.localizeImagesByDefault;
  }

  onOpen(): void {
    this.disposed = false;
    this.modalEl.addClass("evidence-inbox-modal");
    this.modalEl.toggleClass("rk-paper", this.owner.settings.paperStyle);
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

  /** Adds links handed over while the window is still on its first step. Returns false once it has moved on. */
  appendInput(text: string): boolean {
    if (this.busy || this.stage !== "input") return false;
    this.inputText = [this.inputText, text.trim()].filter(Boolean).join("\n");
    this.renderInput();
    return true;
  }

  private renderInput(): void {
    this.stage = "input";
    this.titleEl.setText("导入小红书公开笔记");
    const { contentEl } = this;
    contentEl.empty();
    this.renderSteps(1);
    contentEl.createEl("p", { cls: "ei-lead", text: "粘贴分享文本或 1–10 条链接，每行一条。" });
    const textarea = contentEl.createEl("textarea", {
      cls: "evidence-inbox-input",
      attr: { rows: "9", placeholder: "粘贴小红书分享文本或链接，每行一条……" }
    });
    textarea.value = this.inputText;
    textarea.addEventListener("input", () => { this.inputText = textarea.value; });
    const detected = contentEl.createDiv({ cls: "ei-clip" });
    void this.offerClipboard(detected, textarea);
    const foot = this.renderFoot("预览阶段不会写入 Vault · 不登录账号，不读收藏");
    const quickStart = foot.createEl("button", { text: "使用说明" });
    quickStart.addEventListener("click", () => {
      this.close();
      this.owner.openOnboarding();
    });
    const preview = foot.createEl("button", { text: "预览", cls: "mod-cta" });
    preview.addEventListener("click", () => void this.loadPreview());
  }

  /** Offers, never fills on its own: links found on the clipboard are added only when the chip is clicked. */
  private async offerClipboard(holder: HTMLElement, textarea: HTMLTextAreaElement): Promise<void> {
    let text = "";
    try {
      text = await navigator.clipboard.readText();
    } catch {
      return;
    }
    if (this.disposed || !holder.isConnected) return;
    const found = extractShareUrls(text, this.owner.settings.maxBatchSize).urls;
    const known = new Set(extractShareUrls(this.inputText, 10).urls);
    const fresh = found.filter((url) => !known.has(url));
    if (!fresh.length) return;
    const chip = holder.createEl("button", { cls: "ei-clip-chip", text: `剪贴板里有 ${fresh.length} 条小红书链接 · 填入` });
    chip.addEventListener("click", () => {
      this.inputText = [this.inputText.trim(), text.trim()].filter(Boolean).join("\n");
      textarea.value = this.inputText;
      holder.empty();
      textarea.focus();
    });
  }

  /** Paste → Preview → Import, so it is always clear which step writes to the vault. */
  private renderSteps(current: 1 | 2 | 3, allDone = false): void {
    const steps = this.contentEl.createDiv({ cls: "ei-steps" });
    ["粘贴", "预览", "导入"].forEach((label, index) => {
      const step = index + 1;
      if (index > 0) steps.createSpan({ cls: "ei-step-sep", text: "—" });
      const state = allDone || step < current ? "is-done" : step === current ? "is-current" : "";
      const item = steps.createSpan({ cls: `ei-step ${state}`.trim() });
      item.createSpan({ cls: "ei-step-n", text: state === "is-done" ? "✓" : String(step) });
      item.createSpan({ text: label });
    });
  }

  private renderFoot(note: string): HTMLElement {
    const foot = this.contentEl.createDiv({ cls: "rk-modal-foot" });
    foot.createDiv({ cls: "rk-foot-note", text: note });
    return foot;
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
    this.progressStep = 2;
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
    this.stage = "other";
    this.titleEl.setText("Evidence Inbox");
    this.contentEl.empty();
    this.renderSteps(this.progressStep);
    const card = this.contentEl.createDiv({ cls: "rk-card is-flat ei-progress" });
    card.createDiv({ cls: "ei-progress-label", text: label });
    const meter = card.createDiv({ cls: "rk-meter" });
    meter.createDiv({ cls: "rk-meter-fill" }).style.setProperty("--rk-fill", `${total ? Math.min(completed / total, 1) * 100 : 0}%`);
    card.createDiv({ cls: "rk-split", text: `${completed} / ${total}` });
    if (this.controller && !this.controller.signal.aborted) {
      const foot = this.renderFoot("已完成的条目会保留，尚未开始的条目停止。");
      const cancel = foot.createEl("button", { text: "取消" });
      cancel.addEventListener("click", () => this.controller?.abort());
    }
  }

  private renderPreview(): void {
    this.stage = "other";
    this.titleEl.setText("核对后再导入");
    const { contentEl } = this;
    contentEl.empty();
    this.renderSteps(2);
    const successes = this.previews.filter((item) => item.kind === "success").length;
    const selectable = this.previews.filter((item) =>
      item.kind === "success" && !item.batchDuplicate && !(item.duplicatePath && item.duplicateManaged === false)
    ).length;
    const failures = this.previews.length - successes;
    const summary = contentEl.createDiv({ cls: "ei-summary" });
    summary.appendText("可选 ");
    summary.createEl("strong", { text: String(selectable) });
    summary.appendText(" 条 · 已排除重复/冲突 ");
    summary.createEl("strong", { text: String(successes - selectable) });
    summary.appendText(" 条 · 无法预览 ");
    summary.createEl("strong", { text: String(failures) });
    summary.appendText(" 条");
    summary.createSpan({ cls: "rk-muted", text: "　预览阶段不会写入 Vault" });

    const list = contentEl.createDiv({ cls: "evidence-inbox-preview-list" });
    this.previews.forEach((item, index) => this.renderPreviewItem(list, item, index));

    const options = contentEl.createDiv({ cls: "ei-options" });
    const templateRow = options.createDiv({ cls: "ei-option-row" });
    templateRow.createSpan({ cls: "ei-option-name", text: "知识卡" });
    const seg = templateRow.createDiv({ cls: "rk-seg" });
    for (const template of KNOWLEDGE_TEMPLATES) {
      const button = seg.createEl("button", {
        text: template.label,
        cls: template.id === this.template ? "is-active" : "",
        attr: { "aria-pressed": String(template.id === this.template), title: template.description }
      });
      button.addEventListener("click", () => {
        this.template = template.id;
        if (this.template === "raw") this.generateWithAi = false;
        this.renderPreview();
      });
    }

    new Setting(options)
      .setName("本地化图片")
      .setDesc("失败时保留远程图片引用，并把该条标为部分完成。")
      .addToggle((toggle) => toggle.setValue(this.localizeImages).onChange((value) => {
        this.localizeImages = value;
      }));

    const aiReady = aiIsConfigured(this.owner.settings, this.owner.getAiApiKey());
    const aiSetting = new Setting(options)
      .setName("用 AI 生成知识卡")
      .setDesc(aiReady
        ? "会把标题、作者、标签、正文和设置中的“我的当前目标”发送到已配置 API；图片不发送。"
        : "AI 默认关闭。需要先在插件设置中启用，并填写 Key、Base URL 与模型。")
      .addToggle((toggle) => toggle
        .setValue(this.generateWithAi)
        .setDisabled(this.template === "raw" || !aiReady)
        .onChange((value) => { this.generateWithAi = value; }));
    aiSetting.setDisabled(this.template === "raw");

    const foot = this.renderFoot(failures ? `${failures} 条无法预览的链接会记进导入报告。` : "某一条失败不会中断其余项目。");
    const back = foot.createEl("button", { text: "返回修改" });
    back.addEventListener("click", () => this.renderInput());
    const importButton = foot.createEl("button", { text: `导入 ${this.selected.size} 条`, cls: "mod-cta" });
    importButton.disabled = this.selected.size === 0;
    importButton.addEventListener("click", () => void this.runImport());
  }

  private renderPreviewItem(container: HTMLElement, item: PreviewItem, index: number): void {
    const row = container.createDiv({ cls: "ei-item" });
    if (item.kind === "failure") {
      row.addClass("is-off", "is-failure");
      row.createSpan({ cls: "ei-check-spacer" });
      row.createDiv({ cls: "ei-thumb is-empty" });
      const meta = row.createDiv({ cls: "ei-meta" });
      meta.createDiv({ cls: "ei-title", text: "无法预览" });
      meta.createDiv({ cls: "ei-sub", text: item.reason });
      meta.createDiv({ cls: "ei-sub", text: item.recovery });
      meta.createEl("code", { text: item.displayUrl });
      row.createSpan({ cls: "rk-chip is-danger", text: "无法预览" });
      return;
    }
    const blocked = Boolean(item.batchDuplicate || item.duplicatePath && item.duplicateManaged === false);
    const checkbox = row.createEl("input", { cls: "ei-check", attr: { type: "checkbox", "aria-label": `选择：${item.source.title}` } });
    checkbox.checked = this.selected.has(index);
    checkbox.disabled = blocked;
    checkbox.addEventListener("change", () => {
      if (checkbox.checked) this.selected.add(index); else this.selected.delete(index);
      this.renderPreview();
    });
    if (blocked || !checkbox.checked) row.addClass("is-off");
    // Remote images are not loaded here; the tile only shows how many will be saved.
    const thumb = row.createDiv({ cls: "ei-thumb" });
    thumb.createSpan({ cls: "ei-thumb-count", text: String(item.source.images.length) });
    thumb.createSpan({ cls: "ei-thumb-unit", text: "图" });
    const meta = row.createDiv({ cls: "ei-meta" });
    meta.createDiv({ cls: "ei-title", text: item.source.title });
    meta.createDiv({ cls: "ei-sub", text: `${item.source.author} · ${item.source.images.length} 张图片 · ${item.source.sourceKind}` });
    const excerpt = item.source.body.slice(0, 180);
    meta.createDiv({ cls: "ei-excerpt", text: excerpt || "未提取到正文" });
    meta.createEl("code", { text: item.plannedPath });
    if (item.duplicatePath && item.duplicateManaged) {
      meta.createDiv({ cls: "ei-sub", text: "只刷新来源区；现有知识卡、“我的笔记”和其他用户内容保持原样。知识卡与 AI 选项只对新笔记生效。" });
    } else if (item.duplicatePath && !item.batchDuplicate) {
      meta.createDiv({ cls: "ei-sub", text: "该同源文件没有 Evidence Inbox 管理标记，本次不会下载图片、调用 AI 或修改文件。" });
    }
    if (item.batchDuplicate) row.createSpan({ cls: "rk-chip", text: "批内重复，已排除" });
    else if (item.duplicatePath && item.duplicateManaged) row.createSpan({ cls: "rk-chip is-accent", text: "将安全更新" });
    else if (item.duplicatePath) row.createSpan({ cls: "rk-chip is-warn", text: "同源冲突，已保护" });
    else row.createSpan({ cls: "rk-chip is-good", text: "新建" });
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
    this.progressStep = 3;
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
    this.stage = "other";
    this.titleEl.setText("导入结果");
    const { contentEl } = this;
    contentEl.empty();
    this.renderSteps(3, true);
    const summary = new Map<ImportResult["outcome"], number>();
    batch.results.forEach((result) => summary.set(result.outcome, (summary.get(result.outcome) ?? 0) + 1));
    const chips = contentEl.createDiv({ cls: "ei-summary" });
    for (const [outcome, count] of summary) {
      chips.createSpan({ cls: `rk-chip ${OUTCOME_TONES[outcome]}`.trim(), text: `${OUTCOME_LABELS[outcome]} ${count}` });
    }
    const list = contentEl.createDiv({ cls: "evidence-inbox-results" });
    for (const result of batch.results) {
      const row = list.createDiv({ cls: `ei-item is-${result.outcome}` });
      const meta = row.createDiv({ cls: "ei-meta" });
      meta.createDiv({ cls: "ei-title", text: result.title });
      if (result.displayUrl.startsWith("http")) meta.createEl("code", { text: result.displayUrl });
      if (result.reason) meta.createDiv({ cls: "ei-sub", text: result.reason });
      if (result.warnings.length) meta.createDiv({ cls: "ei-sub", text: result.warnings.join("；") });
      row.createSpan({ cls: `rk-chip ${OUTCOME_TONES[result.outcome]}`.trim(), text: OUTCOME_LABELS[result.outcome] });
      if (result.path) {
        const open = row.createEl("button", { text: "打开笔记" });
        open.addEventListener("click", () => void this.openPath(result.path!));
      }
    }
    const foot = this.renderFoot(batch.reportPath ? "每次导入都会写一份报告。" : "");
    if (batch.reportPath) {
      const report = foot.createEl("button", { text: "打开导入报告" });
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
      const retry = foot.createEl("button", { text: "重试失败项" });
      retry.addEventListener("click", () => {
        this.inputText = failedUrls.join("\n");
        this.renderInput();
      });
    }
    const done = foot.createEl("button", { text: "完成", cls: "mod-cta" });
    done.addEventListener("click", () => this.close());
  }

  private async openPath(path: string): Promise<void> {
    const file = this.app.vault.getAbstractFileByPath(path);
    if (file instanceof TFile) await this.app.workspace.getLeaf(true).openFile(file);
  }
}
