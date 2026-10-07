# 通知

> 原 `DECISIONS.md` §5(2026-10-07 迁入),措辞保持设计定稿原文。外部配额数值的核实日期见 [external-facts.md](./external-facts.md)。

- 双通道(Telegram、邮件),每通道独立配置矩阵:实时开/关 × 周报开/关,可同时开启。
- 邮件传输二选一可配,**send_email binding 主力**:发给账号内"已验证目的地地址"免费档免费且不计配额;需在 Dashboard 开启(Compute → Email Service → Onboard Domain);限制 ≤5MiB、收件人 ≤50;PostalMime 只用于解析收件,**构造发件**用结构化对象(`{to, from, subject, html, text}`)或 `createMimeMessage()`。**Resend 后备**:免费 3000/月、硬顶 100/天;`resend.dev` 域名只能发注册账号本人邮箱。
- TG:HTML parse_mode(长列表用 `<blockquote expandable>`),单条上限 4096 字符(实体解析后);超限**分段发送**,对同一 chat 限速 1 条/秒。
- **失败告警**:某源连续 3 次探测失败 → 经 TG 实时通道发"源 X 连续 3 次探测失败";恢复后发恢复通知。其余失败静默重试,last_success 在 /feed 与后台可见。
- 业务 secrets(TG token、Resend key、收件地址、chat id、管理密码哈希)**全部存 D1**;env 与 GitHub secrets 只放 CF 部署凭据。这是有意偏离参考 deploy.yml 中 `wrangler secret put` 的做法。
