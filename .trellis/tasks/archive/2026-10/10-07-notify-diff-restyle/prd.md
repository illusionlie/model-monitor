# 通知文案重构:diff 风格模板 + 邮件内联样式修复

## Goal

通知文案改为 git diff 风格(`+`/`-` 行、diffstat 段头),并修复邮件 HTML 样式从未生效的 bug(`EMAIL_STYLE` 规则集被塞进 `<body style>` 属性,且内含未转义双引号截断标签)。用户已确认按本 PRD 定稿样式实施。

## 背景(诊断结论,2026-10-07)

- 用户邮件收到的是**无样式的 HTML 部分**(自检证实:含 `· 新增 2` 标题与括号富字段),根因即上述 style 属性 bug;transport 无问题。
- 事实修正:邮件主力通道实际为 **Email Routing(免费,发送到已验证目的地)**,非 spec 原记的 Email Service(该产品 Dashboard 标注需 Workers Paid);结构化对象 `env.SEND_EMAIL.send({to,from,subject,html,text})` 在该路径实测可用,HTML 与 text 部分均送达。需同步修正 `spec/product/notifications.md` 与 `external-facts.md`。

## Requirements

### R1 时间头部两行(仅通知,后台不动)

- `lib/time.ts` 新增 `formatDualTimeLines(date: Date | string): string`,返回:
  ```
  北京时间 2026-10-07 15:30
  UTC时间 2026-10-07 07:30
  ```
- 所有通知头部(本轮 TG/邮件、周报 TG/邮件)换用;`formatDualBeijingUtc` 保留(dispatch.ts 测试通知等单行场景仍用)。

### R2 TG 模板(renderRoundTg / renderWeeklyTg)

结构定稿:

```
📡 <b>模型监视 · 本轮变更</b>
北京时间 2026-10-07 15:30
UTC时间 2026-10-07 07:30

⚠️ <b>OpenRouter</b> 连续 3 次探测失败 · HTTP 502
🛩️ <b>BigModel</b> 探测已恢复
✅ <b>OpenRouter</b> 已接入 · 存量 42 个模型(静默 seed)

<b>OpenRouter</b> <b>+2</b> <b>-1</b>
<blockquote expandable>
+ <code>openai/gpt-5.1</code> · GPT-5.1 · ctx 400k · 2025-08-07
+ <code>anthropic/claude-5-sonnet</code> · ctx 200k
- <code>google/gemini-2.5-flash</code>
</blockquote>
```

- 每源段头为 diffstat:`<b>源名</b> <b>+A</b> <b>-D</b>`(A/D 为本源本轮 added/delisted 计数;仅有一类时只显示存在的计数)。
- **同一源的 added+delisted 合并进一个 `<blockquote expandable>`**,行首 `+`/`-`,顺序:added 在前、delisted 在后。
- 模型 id 用 `<code>` 包裹;富字段(显示名 · ctx · 日期)沿用现有 `modelLineTg` 逻辑,不再输出「新增/下架」字样(符号即语义)。
- 系统消息行(seed/fail/recovered)保持 emoji 风格,措辞统一为:`✅ <b>源名</b> 已接入 · 存量 N 个模型(静默 seed)`、`⚠️ <b>源名</b> 连续 N 次探测失败 · 错误信息`、`🛩️ <b>源名</b> 探测已恢复`。
- 降级:单源 added > 15(DEGRADE_THRESHOLD 不变)→ 仅列前 3(DEGRADE_SHOW 不变),块内末行 `…其余 N 个,完整列表见 /feed`;delisted 不降级。
- 周报:标题 `📊 <b>模型监视 · 周报 2026-W41</b>` + 两行时间 + `统计自 …` 行 + 统计行,段落沿用上述新 section 渲染;「当前在架」行保留。

### R3 邮件模板(renderRoundEmail / renderWeeklyEmail)

- **主题**:`📡 模型监视:+3 -1`;有 seed 时追加 ` · 新源 1`。周报主题:`📊 模型监视周报 2026-W41:+N -N`。
- **HTML**:GitHub diff 卡片风格,全量 inline style(每个元素 style 属性),**禁止 `<style>` 块、禁止规则集字符串**:
  - 外层页面底色 `#f6f8fa`,内层白色卡片(圆角 + 1px 边框 `#d0d7de`,max-width 680px 居中)。
  - 标题区:`📡 模型监视 · 本轮变更`(18px)+ 两行时间(12px 灰 `#57606a`)。
  - 系统消息:diff 区上方的信息条(浅蓝底 `#ddf4ff` + 左侧 4px `#0969da` 边线,含 ✅/⚠️/🛩️)。
  - 每源一个「文件头」条:`#eff2f5` 底、源名(bold)+ 右侧 diffstat `+2`(`#1a7f37` bold)`-1`(`#cf222e` bold)。
  - diff 行:等宽字体(`ui-monospace, SFMono-Regular, Menlo, Consolas, monospace` 12px),行内 `+`/`-` 前缀;added 行底 `#e6ffec`、字 `#1a7f37`;delisted 行底 `#ffebe9`、字 `#cf222e`;底色用 `bgcolor` 属性 + `style background-color` 双写(Outlook 兼容)。
  - 富字段在模型 id 之后,同色系淡化(较浅色或灰 `#57606a`)。
  - 降级行:hunk header 风格 `@@ 仅列前 3 个,共 23 个 · 完整列表见 /feed @@`(浅蓝灰底 `#f2f5f8`、字 `#59636e`)。
  - 周报:「本周统计」行 + 各源 section(同上)+「当前在架」列表,风格统一。
- **text 版**:与 TG 同构(`+`/`-` 行、两行时间头部),替换现有 `[新增 2] 渠道名: a; b` 分号串;系统消息行 `[接入]/[失败]/[恢复]` 前缀保留。

### R4 测试

- `test/dispatch.test.ts` 现有 3 处断言随新文案更新。
- 新增/更新边界用例:降级阈值(15/16 个)、± 混合单源、富字段缺失、text 版格式、两行时间格式、邮件 HTML 不含 `<style>` 与规则集内嵌、bgcolor 双写存在。

## Acceptance Criteria

- [ ] `npm run typecheck` 0 错误;`npm test` 全绿。
- [ ] renderRoundTg / renderRoundEmail / renderWeeklyTg / renderWeeklyEmail 输出与 R2/R3 定稿一致(以本 PRD mockup 为基准)。
- [ ] 邮件 HTML:所有样式为逐元素 inline;无 `<style>` 块;`style` 属性内无嵌套双引号;diff 行含 bgcolor 双写。
- [ ] 通知时间全部双标注(北京时间/UTC时间 两行),复用 lib/time.ts 新函数,无手拼时间。
- [ ] DEGRADE_THRESHOLD=15 / DEGRADE_SHOW=3 / 降级提示语义不变(措辞可随新风格微调)。
- [ ] spec 修正:notifications.md 与 external-facts.md 中 Email Service 表述改为 Email Routing(免费/已验证目的地)+ 核实日期。

## 非目标

- 不改 email.ts transport 选择与发送逻辑。
- 不改事件语义、降级阈值数值、dispatch 通道矩阵。
- 不改后台(/admin)与 /feed 展示。
