import { App, Notice, PluginSettingTab, SettingPage, type SettingDefinitionItem } from "obsidian";
import type EvidenceInboxPlugin from "../main";
import type { EvidenceInboxSettings } from "../settings";
import { KNOWLEDGE_TEMPLATES } from "../core/knowledge-templates";
import { normalizeVaultFolder } from "../core/paths";
import { AI_LANG } from "../ai/kit";
import type { AiServiceSlot } from "../ai/migrate";
import { renderAiSettings } from "../vendor/rex-ai-kit/settingsUI";
import type { KnowledgeTemplateId } from "../types";
import { createObsidianPicker } from "./obsidian-picker";
import { watchSettingGroups } from "./setting-groups";

type FolderKey = "captureFolder" | "mediaFolder" | "reportFolder";
const FOLDER_FALLBACKS: Record<FolderKey, string> = {
  captureFolder: "Evidence Inbox/小红书",
  mediaFolder: "Evidence Inbox/Assets",
  reportFolder: "Evidence Inbox/Reports"
};
const LINK = "obsidian://evidence-inbox?url=";

/** Declarative settings (Obsidian 1.13+), so every row shows up in Obsidian's settings search. */
export class EvidenceInboxSettingTab extends PluginSettingTab {
  constructor(app: App, readonly owner: EvidenceInboxPlugin) {
    super(app, owner);
    this.containerEl.addClass("evidence-inbox-settings", "ap", "ap-settings");
    owner.register(() => this.hide());
  }

  private stopGroups: (() => void) | null = null;

  /** Marks group edges while the tab is open; started on every display, stopped on hide and unload. */
  private watchGroups(): void {
    if (this.stopGroups) return;
    this.stopGroups = watchSettingGroups(this.containerEl);
  }

  hide(): void {
    this.stopGroups?.();
    this.stopGroups = null;
    super.hide();
  }

  getControlValue(key: string): unknown {
    return this.owner.settings[key as keyof EvidenceInboxSettings];
  }

  async setControlValue(key: string, value: unknown): Promise<void> {
    const settings = this.owner.settings;
    if (key in FOLDER_FALLBACKS) {
      const folder = key as FolderKey;
      settings[folder] = normalizeVaultFolder(String(value), FOLDER_FALLBACKS[folder], this.app.vault.configDir);
    } else if (key === "noteCssClass") {
      settings.noteCssClass = String(value).trim();
    } else if (key === "userContext") {
      settings.userContext = String(value).trim().slice(0, 4_000);
    } else if (key === "serifNumbers") {
      settings.serifNumbers = value === true;
    } else if (key === "localizeImagesByDefault" || key === "aiEnabled") {
      settings[key] = Boolean(value);
    }
    await this.owner.saveSettings();
    // Show or hide the AI rows after AI is switched on or off.
    this.refreshDomState();
  }

  getSettingDefinitions(): SettingDefinitionItem[] {
    this.watchGroups();
    const settings = this.owner.settings;
    // The AI rows appear only while AI is on.
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
          },
          {
            name: "笔记样式类",
            desc: "写进每篇导入笔记和报告的 cssclasses，让库里的 CSS 片段给它换样子；插件本身不带这个样式。留空就不加。",
            aliases: ["Note CSS class", "cssclasses"],
            control: { type: "text", key: "noteCssClass", placeholder: "例如 evidence-note" }
          },
          {
            name: "数字用衬线",
            desc: "导入进度的数字用 Didot 斜体；没装 Didot 的系统用 Georgia。",
            aliases: ["font", "Didot", "字体", "衬线"],
            control: { type: "toggle", key: "serifNumbers" }
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
            desc: "启用后，所选笔记的标题、作者、标签和正文会发送到所选 AI 服务；图片不会发送。请自行确认服务商的数据政策与费用。基础归档在 AI 关闭或失败时仍可完成。",
            control: { type: "toggle", key: "aiEnabled" }
          },
          {
            type: "page",
            name: "AI 服务",
            desc: "只在你点检查、刷新或导入时联网。",
            displayValue: () => `${this.owner.ai.provider(settings.ai).name} · ${settings.ai.model || "—"}`,
            status: () => (this.owner.ai.hasKey(settings.ai) ? null : "warning"),
            page: () => new AiServicePage(this),
            visible: aiOn
          },
          {
            name: "我的当前目标",
            desc: "帮助 AI 判断相关性和可连接项目；不要填写密码、证件号等敏感信息。",
            control: { type: "textarea", key: "userContext", rows: 5, placeholder: "例如：医学研究、日本生活、AI 产品开发……" }, visible: aiOn
          },
        ]
      }
    ];
  }

  /** Saves the AI slot changed on its own page and refreshes the entry's value and warning. */
  async saveAi(slot: AiServiceSlot): Promise<void> {
    this.owner.settings.ai = slot;
    await this.owner.saveSettings();
    this.update();
  }
}

/**
 * The shared "AI service" group: provider, Keychain key with Check and balance, recommended models.
 * Knowledge cards send text only, so Claude Code and Codex on this computer are offered on desktop.
 * Nothing is requested until the user presses Check or Refresh.
 */
class AiServicePage extends SettingPage {
  private ui: { destroy(): void } | null = null;
  private stopGroups: (() => void) | null = null;

  constructor(private readonly tab: EvidenceInboxSettingTab) {
    super();
    this.title = "AI 服务";
  }

  display(): void {
    const el = this.containerEl;
    this.ui?.destroy();
    el.empty();
    el.addClass("evidence-inbox-settings", "ap", "ap-settings");
    this.ui = renderAiSettings(el, {
      app: this.tab.app,
      client: this.tab.owner.ai,
      slot: this.tab.owner.settings.ai,
      scene: "cheap",
      lang: AI_LANG,
      // The page title already says AI service.
      heading: false,
      privateContent: true,
      allowLocalAgents: true,
      onChange: (slot) => this.tab.saveAi(slot)
    });
    this.stopGroups?.();
    this.stopGroups = watchSettingGroups(el);
  }

  hide(): void {
    this.ui?.destroy();
    this.ui = null;
    this.stopGroups?.();
    this.stopGroups = null;
    super.hide();
  }
}
