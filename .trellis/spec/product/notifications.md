# 通知

> 原 `DECISIONS.md` §5(2026-10-07 迁入),措辞保持设计定稿原文。外部配额数值的核实日期见 [external-facts.md](./external-facts.md)。

- 双通道(Telegram、邮件),每通道独立配置矩阵:实时开/关 × 周报开/关,可同时开启。
- 邮件传输二选一可配,**send_email binding 主力**:免费走 **Email Routing** 路径,发给账号内"已验证目的地地址"免费且不计配额(2026-10-07 账内核实;Email Service 的 Onboard Domain 发件在 Dashboard 标注需 Workers Paid,免费档不用);限制 ≤5MiB、收件人 ≤50;PostalMime 只用于解析收件,**构造发件**用结构化对象(`{to, from, subject, html, text}`;2026-10-07 实测经 Email Routing 路径 HTML+text 双部分均送达)。**Resend 后备**:免费 3000/月、硬顶 100/天;`resend.dev` 域名只能发注册账号本人邮箱。
- TG:HTML parse_mode(长列表用 `<blockquote expandable>`),单条上限 4096 字符(实体解析后);超限**分段发送**,对同一 chat 限速 1 条/秒。
- **失败告警**:某源连续 3 次探测失败 → 经 TG 实时通道发"源 X 连续 3 次探测失败";恢复后发恢复通知。其余失败静默重试,last_success 在 /feed 与后台可见。
- **通道发送失败可见性(2026-10-08,notify_fail)**:实时通知/周报中「已启用且配置完整」的通道发送未全送达(TG `sent<total` 段、email 失败)→ 落一条 `notify_fail` 系统事件(source_id=0、source_name=通道名、suppressed=1、dedup_group=`notify:{channel}`、payload 含 sent/total/error 摘要),后台最近事件与 /feed 可见;`suppressed=1` 保证其永不进入任何通知通道(防「失败→告警→再失败」循环),周报聚合自动排除。事件 `notified` 仅在全送达时置 1(TG `sent===total` / email ok)——部分失败不再显示「已通知」。不做实时通知重试(事件已落库)。周报失败同样落 `notify_fail`;门控由 engine 在 `weekly()` 正常返回后写回(发送失败被吞不抛错,失败内容不自动重发)。后台「发送测试通知」失败直接回错误摘要。未启用/未配置的通道不算失败、不落事件。
- 业务 secrets(TG token、Resend key、收件地址、chat id、管理密码哈希)**全部存 D1**;env 与 GitHub secrets 只放 CF 部署凭据。这是有意偏离参考 deploy.yml 中 `wrangler secret put` 的做法。
- 文案风格(2026-10-07 定稿,实现在 `src/notify/render.ts`):git diff 隐喻——每源 diffstat 段头「源名 +A -D」(仅非零计数)+ 同源 added/delisted 合并 diff 块,行首 `+`/`-` 即语义,不再写「新增/下架」字样;TG 模型 id 用 `<code>`、列表单个 `<blockquote expandable>`;邮件为 GitHub diff 卡片,样式**逐元素 inline**(禁 `<style>` 块、style 值内禁双引号,diff 行 bgcolor 双写兼容 Outlook);通知头部时间两行「北京时间 … / UTC时间 …」(`lib/time.ts::formatDualTimeLines`,单行场景仍用 `formatDualBeijingUtc`)。
