# LLM 模型监视器 · 决策记录

> 日期:2026-10-06 · 状态:设计定稿(grill 会话收敛),实现未开始
> 本文档是与用户逐轮确认后锁定的全部决策,交给执行模型实现。**契约与语义以本文为准**;§11 之外的部分不要擅自变更。§9 标注"已核实"的外部事实核实于 2026-10-06,若实现时怀疑过期,重新核实而不是凭记忆。

## 0. 一句话定位

自用的 Cloudflare Workers 服务:定时轮询 LLM 模型目录与自有渠道端点,diff 出"新增/下架",经 Telegram 和邮件通知;带一个密码保护的小设置后台。全程跑在免费档。

## 1. 事件语义(核心,先读这节)

- 每个源独立 diff 其"模型 id 集合"的增减。**与模型发布时间无关**,`created` 类字段只作富源消息展示的辅助,不参与判定。
- 两种源类型:
  - **全局目录源**:v1 内置 OpenRouter 与 models.dev,语义是"世界最近出了什么新模型"。
  - **渠道源**:任意 OpenAI 兼容 `GET {base_url}/models`(如 OpenCode Zen、Cline Provider),语义是"这个渠道的货架上多了/少了什么"。
- **去重只发生在全局目录组内**:同一模型在两个目录先后出现,只报第一次,第二次完全静默(不提示"另见于 X")。渠道源永不与全局组去重,渠道之间也互不去重。
- 事件只有两类:`added` / `delisted`,各自有开关。变价、字段变更不报(v1)。
- `delisted` 判死需**连续 2 次**探测缺席(30 分钟间隔下约 1 小时确认期);首次缺席只在内部标记,不发通知。
- **新源首次探测静默 seed**:存量模型全量入库不通知,仅发一条"源 X 已接入,存量 N 个模型"确认。首次部署时两个内置目录源同理。
- 防刷屏:单轮多事件合并为一条消息;单源单轮新增超过 **15** 个时降级为摘要+计数,引导去 /feed 看全量。

## 2. 数据源

| 源 | 端点 | 鉴权 | 备注 |
|---|---|---|---|
| OpenRouter | `GET https://openrouter.ai/api/v1/models` | 无需(配置仍要求留 key 位) | 富源:pricing/context_length/knowledge_cutoff/benchmarks/reasoning 等字段齐全 |
| models.dev | `GET https://models.dev/api.json` | 无需 | 富源:全 provider 字典,含 release_date/last_updated |
| 渠道源 ×N | `GET {base_url}/models` | 可选 Bearer key | 用户在后台增删;参考对象:OpenCode Zen、Cline Provider |

- 渠道源 diff **只认 id**;`created` 字段不可信作信号(见 §9 Zen 实测)。
- allowlist(provider 白名单)仅作用于全局目录源,默认全量,存 settings。

## 3. 调度

- **单 cron trigger**。wrangler.toml.example 中默认 `*/30 * * * *` 作为兜底(占位符 `__CRON_EXPRESSION__`)。
- CI 提供 workflow_dispatch 输入 `cron_minutes`(可选,按分钟):部署时生成 cron 表达式填入。映射规则:
  - N ≤ 59 → `*/N * * * *`(整点重置导致的间隔抖动可接受,监视场景无关痛痒)
  - N = 60 → `0 * * * *`;N > 60 且为 60 的倍数 → `0 */H * * *`
  - 其他值向上取整到小时档;> 1440 按 1440 处理
  - 空缺/非法输入 → 兜底 `*/30`
- 周报走同一 cron 的内部门控:每周五 21:00(Asia/Shanghai)后首个触发且本周未发过。
- 展示时区统一北京时间;**所有通知消息中的时间戳必须同时标注 UTC**。

## 4. 存储(D1-only,无 KV)

- 表:`settings`(k-v)、`sources`(类型/base_url/api_key/启用/last_hash/last_success/missing 标记)、`models`(dedup 组归属、first_seen/last_seen、富字段快照)、`events`。
- **diff 在 Worker 内存做,D1 只写变化**——严禁每轮全量 upsert last_seen(免费档 D1 写配额 10 万行/天;两个 ~500 模型的目录 × 48 轮/天会吃掉一半)。
- **body hash 短路是硬要求**:响应体 SHA-256 未变则跳过解析(models.dev 5.3MB;免费档 CPU 10ms/次,官方允许偶发突发但不应依赖)。
- 事件日志 v1 不清理(二期做清理任务)。

## 5. 通知

- 双通道(Telegram、邮件),每通道独立配置矩阵:实时开/关 × 周报开/关,可同时开启。
- 邮件传输二选一可配,**send_email binding 主力**:发给账号内"已验证目的地地址"免费档免费且不计配额;需在 Dashboard 开启(Compute → Email Service → Onboard Domain);限制 ≤5MiB、收件人 ≤50;PostalMime 只用于解析收件,**构造发件**用结构化对象(`{to, from, subject, html, text}`)或 `createMimeMessage()`。**Resend 后备**:免费 3000/月、硬顶 100/天;`resend.dev` 域名只能发注册账号本人邮箱。
- TG:HTML parse_mode(长列表用 `<blockquote expandable>`),单条上限 4096 字符(实体解析后);超限**分段发送**,对同一 chat 限速 1 条/秒。
- **失败告警**:某源连续 3 次探测失败 → 经 TG 实时通道发"源 X 连续 3 次探测失败";恢复后发恢复通知。其余失败静默重试,last_success 在 /feed 与后台可见。
- 业务 secrets(TG token、Resend key、收件地址、chat id、管理密码哈希)**全部存 D1**;env 与 GitHub secrets 只放 CF 部署凭据。这是有意偏离参考 deploy.yml 中 `wrangler secret put` 的做法。

## 6. 后台(同一 Worker 内的路由,不是独立应用)

- 自管密码鉴权:PBKDF2(WebCrypto)+ 时序安全比较 + session cookie。**不用** Cloudflare Access、不用 better-auth。
- 路由:`/setup`——仅未初始化时开放(设管理密码 → 填通知配置),完成后永久关闭;`/admin`——设置、源管理(增删渠道源)、最近事件列表、**立即运行**、**发送测试通知**;`/feed` 见 §8。
- scheduled 与"立即运行"共享同一执行函数;路由触发时需与 cron 触发互斥(避免撞车)。

## 7. 部署(对齐用户既有惯例;参考仓库根 deploy.yml、deploy2.yml)

- 仓库只留 `wrangler.toml.example`(占位符 `__WORKER_NAME__`、`__D1_DATABASE_ID__`、`__CRON_EXPRESSION__` 等);wrangler.toml 不入库。
- GitHub Actions(私库):push + workflow_dispatch 触发;按 name 查找 D1、不存在则自动创建(支持 `CF_D1_DATABASE_ID` secret 指定既有库并校验存在);检测"是否初始化 / migrations 目录是否变更"决定是否 `wrangler d1 migrations apply --remote`(workflow 输入可手动强制);sed 从 example 生成 wrangler.toml;可选 `CUSTOM_DOMAIN` secret 追加 routes;`wrangler deploy`。
- GH secrets 只放部署凭据(CF_API_TOKEN、可选 CF_ACCOUNT_ID、WORKER_NAME 等);业务密钥不经 CI。

## 8. Feed

- `GET /feed`,secret header 鉴权:事件列表(时间倒序)+ 每源统计(当前模型总数、last_success)。RSS 二期。

## 9. 已核实的外部事实(2026-10-06,过期请重核)

| 事实 | 数值/结论 |
|---|---|
| OpenRouter `/api/v1/models` | 免鉴权 200;~772KB;464 模型;无 ETag(需自做 hash);含 `created`(真实) |
| models.dev `/api.json` | 200;~5.3MB;provider→models 字典;无瘦身子端点(302 探测无果) |
| OpenCode Zen `https://opencode.ai/zen/v1/models` | 免鉴权 200;86 模型;**`created` 是响应生成时刻(全同值且随请求变化),是噪声,不可作信号** |
| Cline Provider `https://api.cline.bot/api/v1/models` | 免鉴权 200;464 模型;id 为 `vendor/model` 式;`created` 真实(375 个不同值)。注意 ClinePass 是订阅档、非 API |
| Workers 免费档 | cron 5 个/账号;subrequest 50/次调用(**KV/D1 binding 也计入**);10 万请求/天;CPU 10ms/次(允许偶发突发) |
| D1 免费档 | 读 500 万行/天;写 10 万行/天;5GB |
| send_email binding | 免费档可发"已验证目的地"且免费;新账号无公开固定日额度(信誉制);成功信件在 Email Routing 统计里显示为 dropped(已知怪癖) |
| Resend 免费 | 3000 封/月、100 封/天硬顶;resend.dev 仅发本人 |
| Telegram | sendMessage ≤4096 字符(实体解析后);HTML 模式支持含 `<blockquote expandable>`;同 chat ≤1 条/秒,群组 ≤20 条/分 |

来源:developers.cloudflare.com(workers/platform/limits、email-routing/email-workers/send-email-workers、email-routing/limits、email-service/platform/pricing、kv/platform/pricing)· resend.com/pricing 及官方 KB · core.telegram.org/bots/api 与 Bots FAQ · opencode.ai/docs/zen · docs.cline.bot/api。

## 10. v1 明确不做

变价/字段变更事件 · RSS · 事件日志清理(二期)· Cloudflare Access / better-auth / KV · 渠道间或渠道×全局去重 · 后台改 cron(改频率 = CI 输入或改 example 后 push)

## 11. 留给执行模型的自由度

- wrangler 版本与配置格式(toml/jsonc);D1 migration 文件拆分
- 路由选型(Hono 或裸 fetch router)与目录结构
- session/cookie 细节、PBKDF2 迭代参数
- UI 形态(单页 vanilla 或轻框架)与样式,移动端可用即可
- TG 分段与消息模板、失败分类(网络/4xx/解析)的日志粒度
- cron 分钟→表达式生成函数按 §3 规则实现并补边界测试
- 时区转换实现(Intl 或 UTC+8 手算)

## 12. 完成定义(粗粒度验收)

1. push 后 CI 全绿:D1 自动创建、迁移应用、worker 部署成功;人工步骤只有填 GH secrets。
2. `/setup` 走通;配完 TG 后"发送测试通知"能收到。
3. "立即运行"完成两个内置目录源首跑:静默 seed、事件表有记录、/feed 可读。
4. 制造一个模型消失后两轮探测内收到 delisted;制造连续 3 次失败触发告警,恢复有通知。
5. 观察一周无 1027(请求超限)/CPU 超限报错。
