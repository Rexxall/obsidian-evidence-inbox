import { App, Modal, Setting } from "obsidian";
import type EvidenceInboxPlugin from "../main";

export class EvidenceInboxOnboardingModal extends Modal {
  constructor(app: App, private readonly owner: EvidenceInboxPlugin) {
    super(app);
  }

  onOpen(): void {
    this.titleEl.setText("Evidence Inbox：从来源到行动");
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("p", {
      text: "粘贴公开的小红书笔记链接，先预览，再保存原文与图片，最后选择是否生成待核验的知识卡。"
    });
    const list = contentEl.createEl("ol");
    list.createEl("li", { text: "复制 1–10 条公开笔记的分享文本或链接。" });
    list.createEl("li", { text: "点击预览，核对标题、作者、图片数量、重复状态和目标路径。" });
    list.createEl("li", { text: "选择仅归档、研究证据卡、日本行动卡或创作者洞察卡。" });
    list.createEl("li", { text: "确认导入；某一条失败不会中断其余项目。" });
    list.createEl("li", { text: "长任务可点“取消”；已完成的条目保留，尚未开始的条目停止。" });
    contentEl.createEl("p", {
      cls: "mod-warning",
      text: "边界：不登录账号，不读取收藏/点赞，不处理验证码，不绕过平台限制。只归档你主动提交且有权保存的内容。"
    });
    new Setting(contentEl)
      .addButton((button) => button.setButtonText("稍后再说").onClick(() => this.close()))
      .addButton((button) => button.setButtonText("开始导入").setCta().onClick(async () => {
        this.owner.settings.hasSeenOnboarding = true;
        await this.owner.saveSettings();
        this.close();
        this.owner.openImportModal();
      }));
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
