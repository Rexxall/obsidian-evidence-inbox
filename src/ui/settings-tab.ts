import { App, Notice, PluginSettingTab, type SettingDefinitionItem } from "obsidian";
import type EvidenceInboxPlugin from "../main";
import type { EvidenceInboxSettings } from "../settings";
import { KNOWLEDGE_TEMPLATES } from "../core/knowledge-templates";
import { normalizeVaultFolder } from "../core/paths";
import { sanitizeAiBaseUrl } from "../settings";
import type { KnowledgeTemplateId } from "../types";
import { createObsidianPicker } from "./obsidian-picker";

type FolderKey = "captureFolder" | "mediaFolder" | "reportFolder";
const FOLDER_FALLBACKS: Record<FolderKey, string> = {
  captureFolder: "Evidence Inbox/小红书",
  mediaFolder: "Evidence Inbox/Assets",
  reportFolder: "Evidence Inbox/Reports"
};
const LINK = "obsidian://evidence-inbox?url=";

/** Declarative settings (Obsidian 1.13+), so every row shows up in Obsidian's settings search. */
export class EvidenceInboxSettingTab extends PluginSettingTab {
  constructor(app: App, private readonly owner: EvidenceInboxPlugin) {
    super(app, owner);
    this.containerEl.addClass("evidence-inbox-settings", "ap", "ap-settings");
  }

  getControlValue(key: string): unknown {
    return this.owner.settings[key as keyof EvidenceInboxSettings];
  }

  async setControlValue(key: string, value: unknown): Promise<void> {
    const settings = this.owner.settings;
    if (key in FOLDER_FALLBACKS) {
      const folder = key as FolderKey;
      settings[folder] = normalizeVaultFolder(String(value), FOLDER_FALLBACKS[folder], this.app.vault.configDir);
    } else if (key === "aiBaseUrl") {
      settings.aiBaseUrl = sanitizeAiBaseUrl(String(value));
    } else if (key === "aiModel") {
      settings.aiModel = String(value).trim();
    } else if (key === "userContext") {
      settings.userContext = String(value).trim().slice(0, 4_000);
    } else if (key === "localizeImagesByDefault" || key === "aiEnabled") {
      settings[key] = Boolean(value);
    }
    await this.owner.saveSettings();
    // Show or hide the AI rows after AI is switched on or off.
    this.refreshDomState();
  }

  getSettingDefinitions(): SettingDefinitionItem[] {
    const settings = this.owner.settings;
    // The AI rows appear only while AI is on; clearing a saved key stays possible either way.
    const aiOn = () => settings.aiEnabled;
    return [
      {
        type: "group",
        items: [
          {
            name: "快速开始",
            desc: "只在你点“预览”或“导入”时联网，处理你主动粘贴的公开链接。点这里看使用步骤，以及插件不做什么。",
            aliases: ["说明", "onboarding"],
            action: () => this.owner.openOnboarding()
          },
          {
            name: "默认本地化图片",
            desc: "图片失败时仍会保存正文，并保留去掉查询参数的远程链接。",
            control: { type: "toggle", key: "localizeImagesByDefault" }
          },
          {
            name: "默认知识卡",
            desc: "“仅原始归档”完全不调用 AI。",
            render: (setting) => {
              createObsidianPicker(
                this.app,
                setting.controlEl,
                KNOWLEDGE_TEMPLATES.map((template) => ({ value: template.id, label: template.label, desc: template.description })),
                settings.defaultTemplate,
                async (value: KnowledgeTemplateId) => {
                  settings.defaultTemplate = value;
                  await this.owner.saveSettings();
                },
                "默认知识卡"
              );
            }
          },
          {
            name: "单批最大链接数",
            desc: "最多 10 条。页面逐条读取，每条之间停约一秒，不对平台集中请求。",
            render: (setting) => {
              createObsidianPicker(
                this.app,
                setting.controlEl,
                Array.from({ length: 10 }, (_, index) => ({ value: String(index + 1), label: `${index + 1} 条` })),
                String(settings.maxBatchSize),
                async (value) => {
                  settings.maxBatchSize = Number(value);
                  await this.owner.saveSettings();
                },
                "单批最大链接数"
              );
            }
          }
        ]
      },
      {
        type: "group",
        heading: "保存位置",
        items: [
          {
            name: "笔记",
            desc: `库内相对路径；不能用 ..，也不能放进隐藏文件夹（例如配置目录 ${this.app.vault.configDir}）。`,
            control: { type: "folder", key: "captureFolder", placeholder: FOLDER_FALLBACKS.captureFolder }
          },
          {
            name: "图片",
            desc: "按来源 ID 命名，重复导入不会多存一份。",
            control: { type: "folder", key: "mediaFolder", placeholder: FOLDER_FALLBACKS.mediaFolder }
          },
          {
            name: "报告",
            desc: "一次导入多条，或有条目未完整导入时，写一份逐条报告。",
            control: { type: "folder", key: "reportFolder", placeholder: FOLDER_FALLBACKS.reportFolder }
          }
        ]
      },
      {
        type: "group",
        heading: "从别处打开",
        items: [
          {
            name: "唤起链接",
            aliases: ["obsidian://", "快捷指令", "Raycast"],
            render: (setting) => {
              setting.descEl.appendText("在快捷指令、Raycast 或浏览器书签里打开 ");
              setting.descEl.createSpan({ cls: "ei-code", text: `${LINK}<编码后的链接>` });
              setting.descEl.appendText("，会打开导入窗口并填好链接；仍要你点“预览”才会联网。");
              setting.addButton((button) => button.setButtonText("复制").onClick(async () => {
                try {
                  await navigator.clipboard.writeText(LINK);
                  new Notice("已复制。在后面接上编码后的分享链接即可。");
                } catch {
                  new Notice("复制失败，请手动选中复制。");
                }
              }));
            }
          }
        ]
      },
      {
        type: "group",
        heading: "可选 AI",
        items: [
          {
            name: "启用 AI 知识卡",
            desc: "自带 key（BYOK），默认关闭。启用后，所选笔记的标题、作者、标签和正文会发送到你配置的 API 服务；图片不会发送。请自行确认服务商的数据政策与费用。基础归档在 AI 关闭或失败时仍可完成。",
            control: { type: "toggle", key: "aiEnabled" }
          },
          {
            name: "API key",
            desc: "使用 Obsidian SecretStorage；不会写进插件 data.json、笔记、报告或日志。",
            render: (setting) => {
              setting.addText((text) => {
                text.inputEl.type = "password";
                text.setPlaceholder(this.owner.hasAiApiKey() ? "已安全保存；粘贴可替换" : "留空表示未配置")
                  .onChange((value) => this.owner.setAiApiKey(value.trim()));
              });
            },
            visible: aiOn
          },
          {
            name: "API base URL",
            desc: "仅允许 HTTPS；本机 localhost 可使用 HTTP。保存前会移除用户名、密码、查询参数和片段。",
            control: { type: "text", key: "aiBaseUrl", placeholder: "https://api.openai.com/v1" }, visible: aiOn
          },
          {
            name: "模型名称",
            desc: "不预设模型，避免替你选择费用或供应商；填写你的服务实际支持的模型 ID。",
            control: { type: "text", key: "aiModel", placeholder: "例如：服务商提供的模型 ID" }, visible: aiOn
          },
          {
            name: "我的当前目标",
            desc: "帮助 AI 判断相关性和可连接项目；不要填写密码、证件号等敏感信息。",
            control: { type: "textarea", key: "userContext", rows: 5, placeholder: "例如：医学研究、日本生活、AI 产品开发……" }, visible: aiOn
          },
          {
            name: "清除 API key",
            desc: "立即从 SecretStorage 移除已保存的 key。",
            render: (setting) => {
              setting.addButton((button) => button
                .setButtonText("清除")
                .setDestructive()
                .setDisabled(!this.owner.hasAiApiKey())
                .onClick(() => {
                  this.owner.setAiApiKey("");
                  button.setDisabled(true);
                  new Notice("已清除 API key。");
                }));
            },
            visible: () => settings.aiEnabled || this.owner.hasAiApiKey()
          }
        ]
      }
    ];
  }
}
