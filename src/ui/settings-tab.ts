import { App, Notice, PluginSettingTab, Setting } from "obsidian";
import type EvidenceInboxPlugin from "../main";
import { KNOWLEDGE_TEMPLATES } from "../core/knowledge-templates";
import { normalizeVaultFolder } from "../core/paths";
import { sanitizeAiBaseUrl } from "../settings";

export class EvidenceInboxSettingTab extends PluginSettingTab {
  constructor(app: App, private readonly owner: EvidenceInboxPlugin) {
    super(app, owner);
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.addClass("evidence-inbox-settings");
    containerEl.createEl("p", {
      cls: "ei-settings-intro",
      text: "只处理你主动粘贴、且你有权归档的公开分享链接。插件不登录账号，也不读取收藏或点赞列表；只在你点“预览”或“导入”时联网。"
    });

    new Setting(containerEl)
      .setName("快速开始")
      .setDesc("重新打开可恢复的新手说明。")
      .addButton((button) => button.setButtonText("打开说明").onClick(() => this.owner.openOnboarding()));

    new Setting(containerEl)
      .setName("默认本地化图片")
      .setDesc("图片失败时仍会保存正文，并保留去掉查询参数的远程链接。")
      .addToggle((toggle) => toggle
        .setValue(this.owner.settings.localizeImagesByDefault)
        .onChange(async (value) => {
          this.owner.settings.localizeImagesByDefault = value;
          await this.owner.saveSettings();
        }));

    new Setting(containerEl)
      .setName("默认知识卡")
      .setDesc("“仅原始归档”完全不调用 AI。")
      .addDropdown((dropdown) => {
        for (const template of KNOWLEDGE_TEMPLATES) dropdown.addOption(template.id, template.label);
        dropdown.setValue(this.owner.settings.defaultTemplate).onChange(async (value) => {
          this.owner.settings.defaultTemplate = value as typeof this.owner.settings.defaultTemplate;
          await this.owner.saveSettings();
        });
      });

    new Setting(containerEl)
      .setName("单批最大链接数")
      .setDesc("最多 10 条。页面逐条读取，每条之间停约一秒，不对平台集中请求。")
      .addDropdown((dropdown) => {
        for (let value = 1; value <= 10; value += 1) dropdown.addOption(String(value), String(value));
        dropdown.setValue(String(this.owner.settings.maxBatchSize)).onChange(async (value) => {
          this.owner.settings.maxBatchSize = Number(value);
          await this.owner.saveSettings();
        });
      });

    new Setting(containerEl).setName("保存位置").setHeading();
    this.addFolderSetting("笔记", "captureFolder", "Evidence Inbox/小红书",
      `库内相对路径；不能用 ..，也不能放进配置目录 ${this.app.vault.configDir}。`);
    this.addFolderSetting("图片", "mediaFolder", "Evidence Inbox/Assets", "按来源 ID 命名，重复导入不会多存一份。");
    this.addFolderSetting("报告", "reportFolder", "Evidence Inbox/Reports", "一次导入多条，或有条目未完整导入时，写一份逐条报告。");

    new Setting(containerEl).setName("外观").setHeading();
    new Setting(containerEl)
      .setName("纸墨风格")
      .setDesc("纸色底、细墨线、衬线数字，强调色用暗红和青绿。关闭时跟随 Obsidian 主题。")
      .addToggle((toggle) => toggle
        .setValue(this.owner.settings.paperStyle)
        .onChange(async (value) => {
          this.owner.settings.paperStyle = value;
          await this.owner.saveSettings();
          this.owner.applyPaperStyle();
        }));

    new Setting(containerEl).setName("从别处打开").setHeading();
    const link = "obsidian://evidence-inbox?url=";
    const linkSetting = new Setting(containerEl)
      .setName("唤起链接")
      .addButton((button) => button.setButtonText("复制").onClick(async () => {
        try {
          await navigator.clipboard.writeText(link);
          new Notice("已复制。在后面接上编码后的分享链接即可。");
        } catch {
          new Notice("复制失败，请手动选中复制。");
        }
      }));
    linkSetting.descEl.appendText("在快捷指令、Raycast 或浏览器书签里打开 ");
    linkSetting.descEl.createSpan({ cls: "ei-code", text: `${link}<编码后的链接>` });
    linkSetting.descEl.appendText("，会打开导入窗口并填好链接；仍要你点“预览”才会联网。");

    new Setting(containerEl)
      .setName("可选 AI")
      .setDesc("自带 key（BYOK），默认关闭。启用后，所选笔记的标题、作者、标签和正文会发送到你配置的 API 服务；图片不会发送。请自行确认服务商的数据政策与费用。")
      .setHeading();

    new Setting(containerEl)
      .setName("启用 AI 知识卡")
      .setDesc("基础归档在 AI 关闭或失败时仍可完成。")
      .addToggle((toggle) => toggle
        .setValue(this.owner.settings.aiEnabled)
        .onChange(async (value) => {
          this.owner.settings.aiEnabled = value;
          await this.owner.saveSettings();
          this.display();
        }));

    const apiKeySetting = new Setting(containerEl)
      .setName("API key")
      .setDesc("使用 Obsidian SecretStorage；不会写进插件 data.json、笔记、报告或日志。")
      .addText((text) => {
        text.inputEl.type = "password";
        text.setPlaceholder(this.owner.hasAiApiKey() ? "已安全保存；粘贴可替换" : "留空表示未配置")
          .onChange((value) => this.owner.setAiApiKey(value.trim()));
      });
    apiKeySetting.setDisabled(!this.owner.settings.aiEnabled);

    const baseUrlSetting = new Setting(containerEl)
      .setName("API base URL")
      .setDesc("仅允许 HTTPS；本机 localhost 可使用 HTTP。保存前会移除用户名、密码、查询参数和片段。")
      .addText((text) => text
        .setPlaceholder("https://api.openai.com/v1")
        .setValue(this.owner.settings.aiBaseUrl)
        .onChange(async (value) => {
          this.owner.settings.aiBaseUrl = sanitizeAiBaseUrl(value);
          await this.owner.saveSettings();
        }));
    baseUrlSetting.setDisabled(!this.owner.settings.aiEnabled);

    const modelSetting = new Setting(containerEl)
      .setName("模型名称")
      .setDesc("不预设模型，避免替你选择费用或供应商；填写你的服务实际支持的模型 ID。")
      .addText((text) => text
        .setPlaceholder("例如：服务商提供的模型 ID")
        .setValue(this.owner.settings.aiModel)
        .onChange(async (value) => {
          this.owner.settings.aiModel = value.trim();
          await this.owner.saveSettings();
        }));
    modelSetting.setDisabled(!this.owner.settings.aiEnabled);

    const contextSetting = new Setting(containerEl)
      .setName("我的当前目标")
      .setDesc("帮助 AI 判断相关性和可连接项目；不要填写密码、证件号等敏感信息。")
      .addTextArea((text) => {
        text.inputEl.rows = 5;
        text.setPlaceholder("例如：医学研究、日本生活、AI 产品开发……")
          .setValue(this.owner.settings.userContext)
          .onChange(async (value) => {
            this.owner.settings.userContext = value.trim().slice(0, 4_000);
            await this.owner.saveSettings();
          });
      });
    contextSetting.setDisabled(!this.owner.settings.aiEnabled);

    new Setting(containerEl)
      .setName("清除 API key")
      .setDesc("立即从 SecretStorage 移除已保存的 key。")
      .addButton((button) => button
        .setButtonText("清除")
        .setWarning()
        .setDisabled(!this.owner.hasAiApiKey())
        .onClick(() => {
          this.owner.setAiApiKey("");
          this.display();
        }));
  }

  private addFolderSetting(
    name: string,
    key: "captureFolder" | "mediaFolder" | "reportFolder",
    fallback: string,
    description: string
  ): void {
    new Setting(this.containerEl)
      .setName(name)
      .setDesc(description)
      .addText((text) => text
        .setValue(this.owner.settings[key])
        .onChange(async (value) => {
          this.owner.settings[key] = normalizeVaultFolder(value, fallback, this.app.vault.configDir);
          await this.owner.saveSettings();
        }));
  }
}
