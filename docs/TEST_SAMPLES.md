# 真实样本验收规范

## 原则

- 只使用测试者自己发布、明确获授权或公开且有权个人归档的内容；
- 不把完整受版权保护正文、原始 HTML、Cookie 或带查询参数分享链接提交 Git；
- 仓库只保存匿名结果矩阵和最小合成夹具；
- 页面不可访问、私密、删除或非笔记链接应计入“预期拒绝”，不混入支持范围成功率。

## 30 条样本矩阵

| 类别 | 数量 | 必测内容 |
| --- | ---: | --- |
| 纯图文公开笔记 | 10 | 1–12 张图、中文正文、话题标签 |
| 长标题/长正文 | 4 | 文件名截断、正文完整性、YAML 安全 |
| 分享短链接 | 4 | `xhslink.cn` 与仍有效的旧格式 |
| 直接网页链接 | 4 | `/explore`、`/discovery/item`、含分享参数 |
| 视频型笔记 | 3 | 正文与封面可归档，明确不下载视频 |
| 少字段/无正文 | 2 | `partial` 与恢复提示 |
| 重复来源 | 1 | 连续导入三次只保留一份 |
| 图片故障 | 1 | 正文落盘、远程引用、`media_status: partial` |
| AI 故障 | 1 | 可手填卡片、`ai_status: failed`、来源仍保存 |

另备 5 条预期拒绝样本，不计入 30 条支持范围：主页、专辑、私密/删除笔记、非小红书 URL、lookalike host。

## 不保存原文的记录表

每条只记录：

```yaml
sample_id: S01
ownership_basis: self-authored | explicit-permission | lawful-personal-archive
input_kind: short-link | explore | discovery-item
note_kind: image | video
image_count_expected: 6
preview: pass | fail
archive: complete | partial | failed
images_localized: 6
images_attempted: 6
duplicate_run_2: updated-one-file
duplicate_run_3: updated-one-file
user_region_preserved: true
secret_scan: pass
notes: "只写兼容性现象，不粘贴正文"
```

## 计算方法

```text
导入成功率 = (complete + 可接受 partial) / 支持范围样本数
图片本地化成功率 = 成功写入且魔数校验通过的图片数 / 可下载图片尝试数
```

“可接受 partial”只限正文与干净来源链接已保存、且失败原因明确的可选步骤；没有正文或错误来源 ID 不能算成功。

## 手动检查

每批后检查：

1. 预览前目录没有新文件；
2. 预览信息与浏览器公开页面一致；
3. 保存路径没有查询参数；
4. 同一 ID 没有第二份 Markdown；
5. 编辑知识卡和 `## 我的笔记` 后再次导入，两处内容完全保留；
6. 断网或填入无效 AI 配置，一条失败不停止后续条目；
7. 在生成的 `Evidence Inbox/` 输出目录搜索 `xsec_token`、`Cookie`、测试 Key，结果为零；
8. 导入报告没有原始 HTML 或完整分享参数；
9. 禁用插件后没有状态栏轮询或后台请求；
10. 删除插件目录后，用户笔记和 Assets 不会被自动删除。

## Beta 决策

- `GO`：导入 ≥ 90%，图片 ≥ 95%，去重/用户保护/秘密扫描全部 100%；
- `NO-GO`：任何覆盖用户内容、跨域媒体请求、秘密泄漏、失败伪装成功；
- 页面结构兼容性问题可修复后重跑受影响子集，但不能从分母静默删除。
