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


## Session 4: 渠道自定义请求头 + 后台 UI 重构

**Date**: 2026-10-07
**Task**: 10-07-channel-headers-admin-ui
**Branch**: `main`

### Summary

用户需求:①每渠道自定义请求头 ②后台 UI 改分组标签页 + 动画/响应式/亮暗切换。AskUserQuestion 定三个决策:单任务 / 渠道顺带做完整编辑(名称/URL/API Key/头) / 头值回显(api_key 维持不回显纪律)。实现:migration 0003 加 sources.extra_headers(JSON);lib/headers.ts 双入口(parseStoredHeaders 容错读 + sanitizeHeaderMap 写校验,≤16 头/CRLF/C0/大小写冲突防护);engine 提取 buildFetchHeaders(accept < Bearer < 自定义头,轮询预算零增加);PATCH 扩展完整编辑(留空=不改/null=清空;改 URL 触发 resetSourceModels 静默重接入);ui.ts→ui/ 目录重构(CSS 变量三态主题 + 防 FOUC + 五标签页 hash 持久 + panelIn/dialogIn + 719.5px 断点 + 原生 dialog 行式 Name: value 头编辑)。双子代理实施 + trellis-check 8 项全 PASS(0 阻塞)+ playwright 手测(登录/编辑保存/坏行拦截/三态主题/375px/无效 hash 回落/reduced-motion 全过)。check 抓出 backend spec 仍引旧 ui.ts,directory-structure/quality-guidelines 已同步。typecheck 0 错、127 用例全绿(+34,新增 test/helpers/d1.ts stub)。本地 admin 密码已改为 handover-test-2026(仅 .wrangler 本地态)。

### Git Commits

| Hash | Message |
|------|---------|
| (本次) | feat: 渠道自定义请求头 + 渠道编辑 + 后台标签页/暗色/响应式重构 |
| (本次) | chore: 任务归档(channel-headers-admin-ui) |

### Status

[OK] **Completed**


## Session 5: 通知失败可见性(notify_fail)

**Date**: 2026-10-08
**Task**: 10-08-notify-fail-event
**Branch**: `main`

### Summary

用户反馈:TG 推送失败的报错只在 CF Dashboard 可见,要求至少能在后台「最近事件(50)」看到。评估确认三连问题:失败不可见、部分段失败仍全标 notified=1(谎报已通知)、events.source_id 的 FK 使系统级事件无合法 source_id(D1 默认强制外键,与本地 SQLite/vitest stub 相反——已记 backend/index.md gotcha #8)。方案:新事件类别 notify_fail(source_id=0、suppressed=1 复用静默机制→永不进任何通知通道、周报聚合自动排除、零循环风险;dedup_group=notify:{channel})+ migration 0004(events 去 FK 重建,删源改应用层显式删 events,「事件记录一并删除」文案行为不变)。notified 改为 TG sent===total / email ok 才标;sendEmail 返回 {ok,error}、notifyTelegram 返回 errors;测试通知失败直回摘要;后台徽章「推送失败」/备注「未推送(通道故障)」。trellis-implement 实施 + trellis-check PASS-WITH-P2(唯一 P1:weekly 门控注释错误——实际发送失败被吞后门控仍标记、内容不重发,已修正注释与 prd/design 同源表述;P2 补 deleteChannelSource batch 测试)。预算复算最坏轮 ≈43≤50。typecheck 0 错、141 用例全绿。本地 migration 0004 apply 验证过(幂等);线上由 CI 自动应用。

### Git Commits

| Hash | Message |
|------|---------|
| 845e74b | feat: 通知发送失败落 notify_fail 事件(后台最近事件可见)+ notified 全送达语义修正 |
| (本次) | chore: 任务归档(notify-fail-event)+ journal Session 5 |

### Status

[OK] **Completed**


## Session 6: 后台表格垂直居中修复

**Date**: 2026-10-08
**Task**: 10-08-table-valign-fix
**Branch**: `main`

### Summary

用户报障:事件标签页条目除模型列外均不垂直居中。定位:css.ts:54 全局 `th,td{…vertical-align:top…}`,事件表「模型」列与渠道源表「最近错误」列是仅有的两处 `td.wrap`(white-space:normal)换行撑高行,其余单行列顶格。修复:全局规则 `top`→`middle` 一处改动同时修两表(每行仅一列 wrap,居中语义无歧义;不换行的行 top/middle 无视觉差)。轻量任务 PRD-only,内联实施。typecheck 0 错、141 用例全绿。spec 未记载该对齐方式,无需同步。

### Git Commits

| Hash | Message |
|------|---------|
| 5294154 | fix: 后台表格单元格垂直居中(事件/渠道源表 wrap 列撑高行时其余列不再顶格) |
| (本次) | chore: 任务归档(table-valign-fix)+ journal Session 6 |

### Status

[OK] **Completed**
