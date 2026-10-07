# Journal - illusionlie (Part 1)

> AI development session journal
> Started: 2026-10-06

---



## Session 1: 实现 LLM 模型监视器 v1(DECISIONS.md 全量落地)

**Date**: 2026-10-07
**Task**: 实现 LLM 模型监视器 v1(DECISIONS.md 全量落地)
**Branch**: `main`

### Summary

按 DECISIONS.md 从零实现 Cloudflare Workers 模型监视器:Trellis 三里程碑子代理(A 引擎/B 通知+后台/C CI+文档)+ 全量 check。交付:hash 短路轮询 diff 引擎、两连击 delisted、目录组去重(含同轮)、TG/邮件双通道矩阵、PBKDF2 后台、/feed、deploy.yml 全自动 CI。75 测试全绿、typecheck 0 错、subrequest 峰值 37/50、写配额 288 行/天。修复 3 个实现期 bug(周报门槛、短路判死、TG 跨消息节流);spec/backend 六文件沉淀。新增决策:源启停路由、allowlist 静默 re-baseline、周报无通道仍标记已发。

### Git Commits

| Hash | Message |
|------|---------|
| `ecec5f1` | (see git log) |
| `788b0aa` | (see git log) |
| `5fb0760` | (see git log) |

### Status

[OK] **Completed**

## Session 2: models.dev 切换 /models.json + 后台源存量清理

**Date**: 2026-10-07
**Task**: 10-07-models-json-and-channel-reset
**Branch**: `main`

### Summary

两个交付物:1) models.dev 目录源从 /api.json(全 provider 渠道面,~5.3MB)切换到 /models.json(扁平 lab/model 字典,~409KB,经代理实测),口径收敛为"实验室级有哪些新模型";迁移 0002 置 rebaseline=1 静默重建,零事件零通知。normalize 字典适配改为按条目分派,旧二层结构保持兼容。2) 后台新增源存量清理:POST /admin/api/sources/:id/reset + UI 按钮(所有源可用,经用户质询后去掉 kind 400 限制——清理非破坏性),清 models 行 + seed_done=0 → 下轮静默重 seed。trellis-implement/check 双子代理流,typecheck 0 错、79 用例全绿(新增 6);spec 同步 data-sources.md / external-facts.md(核实日期 2026-10-07)。

### Git Commits

| Hash | Message |
|------|---------|
| `bed73d7` | feat: models.dev 切换 /models.json 实验室级目录 + 后台源存量清理 |

### Status

[OK] **Completed**


## Session 3: 通知文案 diff 风格重构 + 邮件内联样式修复

**Date**: 2026-10-07
**Task**: 10-07-notify-diff-restyle
**Branch**: `main`

### Summary

用户反馈邮件"只收到纯文本",诊断出根因:EMAIL_STYLE(CSS 规则集)被塞进 <body style> 属性且含未转义双引号,样式从未生效——用户收到的实为无样式 HTML(自检证实)。顺手按用户需求重构全部通知文案为 git diff 风格:每源 diffstat 段头「源名 +A -D」+ 合并 diff 块(+/- 行首),邮件 GitHub diff 卡片(逐元素 inline style、bgcolor 双写),头部时间两行「北京时间 … / UTC时间 …」(lib/time.ts 新增 formatDualTimeLines)。trellis-implement/check 双子代理流,check 报 1 阻断(spec 未同步,主会话职责)+ 2 建议均已修复(shelfCounts 转义泄入 text 版、release_date 脏数据转义)。事实修正:邮件主力通道实为 Email Routing(免费/已验证目的地),Email Service Onboard Domain 需 Workers Paid——notifications.md / external-facts.md 已同步。typecheck 0 错、98 用例全绿(新增 20)。

### Git Commits

| Hash | Message |
|------|---------|
| (本次) | feat: 通知文案 diff 风格重构 + 邮件内联样式修复 |
| (本次) | chore: spec 修正(send_email 免费路径)+ 任务归档 |

### Status

[OK] **Completed**
