# PRD: LLM 模型监视器 v1

> 需求来源:`DECISIONS.md`(2026-10-06 设计定稿,grill 会话收敛)。
> 本 PRD 是其需求侧转录;**契约与语义冲突时以 DECISIONS.md 为准**。§11(执行自由度)对应的技术选型见 design.md。

## 1. 定位

自用的 Cloudflare Workers 服务:定时轮询 LLM 模型目录与自有渠道端点,diff 出"新增/下架",经 Telegram 和邮件通知;带一个密码保护的小设置后台。**全程跑在免费档**,不引入付费依赖。

## 2. 功能需求

### 2.1 数据源(DECISIONS §2)

- 内置全局目录源 ×2:OpenRouter `GET https://openrouter.ai/api/v1/models`、models.dev `GET https://models.dev/api.json`。均免鉴权,但 OpenRouter 配置仍保留 key 位。
- 渠道源 ×N(用户后台增删):任意 OpenAI 兼容 `GET {base_url}/models`,可选 Bearer key。参考对象:OpenCode Zen、Cline Provider。
- allowlist(provider 白名单)仅作用于全局目录源,默认全量,存 settings。

### 2.2 事件语义(DECISIONS §1,核心)

- 每个源独立 diff 其"模型 id 集合"的增减;`created` 等字段不参与判定,只作富源消息展示辅助。
- 事件只有 `added` / `delisted` 两类,各有独立开关。变价、字段变更不报。
- `delisted` 需连续 2 次探测缺席才判死并发通知;首次缺席只内部标记。
- 去重只发生在全局目录组内:同一模型在两个目录先后出现只报第一次,第二次完全静默。渠道源永不与全局组、与其他渠道去重。
- 新源首次探测静默 seed:存量模型全量入库不通知,仅发一条"源 X 已接入,存量 N 个模型"确认。
- 防刷屏:单轮多事件合并为一条消息;单源单轮新增 >15 个时降级为摘要+计数。

### 2.3 调度(DECISIONS §3)

- 单 cron trigger,默认 `*/30 * * * *`(占位符 `__CRON_EXPRESSION__`)。
- CI workflow_dispatch 输入 `cron_minutes` 生成表达式,映射规则见 DECISIONS §3(≤59 → `*/N`;60 → `0 * * * *`;>60 的 60 倍数 → `0 */H`;其余向上取整到小时档;>1440 按 1440;空缺/非法 → `*/30`)。
- 周报走同一 cron 内部门控:每周五 21:00(Asia/Shanghai)后首个触发且本周未发过。
- 展示时区北京时间;**所有通知消息中的时间戳必须同时标注 UTC**。

### 2.4 存储(DECISIONS §4)

- D1-only,无 KV。表:settings、sources、models、events。
- diff 在 Worker 内存做,D1 只写变化——严禁每轮全量 upsert last_seen(写配额 10 万行/天)。
- body hash(SHA-256)短路:响应体未变则跳过解析。
- 事件日志 v1 不清理。

### 2.5 通知(DECISIONS §5)

- 双通道(Telegram、邮件),每通道独立矩阵:实时开/关 × 周报开/关,可同时开启。
- 邮件:send_email binding 主力(仅发"已验证目的地地址");Resend 后备(免费 3000/月、100/天;resend.dev 仅发本人)。构造发件用结构化对象。
- TG:HTML parse_mode,长列表用 `<blockquote expandable>`;单条 ≤4096 字符(实体解析后),超限分段;同 chat 限速 1 条/秒。
- 失败告警:某源连续 3 次探测失败 → TG 实时通道告警;恢复后发恢复通知;其余失败静默重试,last_success 可见。
- 业务 secrets(TG token、Resend key、收件地址、chat id、管理密码哈希)全部存 D1;env 与 GitHub secrets 只放 CF 部署凭据。

### 2.6 后台与 Feed(DECISIONS §6、§8)

- 同一 Worker 内路由:`/setup`(仅未初始化时开放,完成后永久关闭)、`/admin`(设置、源管理、最近事件、立即运行、发送测试通知)、`GET /feed`(secret header 鉴权:事件列表倒序 + 每源统计)。
- 自管密码鉴权:PBKDF2(WebCrypto)+ 时序安全比较 + session cookie。不用 Cloudflare Access / better-auth。
- scheduled 与"立即运行"共享同一执行函数,且互斥(防撞车)。

### 2.7 部署(DECISIONS §7)

- 仓库只留 `wrangler.toml.example`;wrangler.toml 不入库。
- GitHub Actions(私库):push + workflow_dispatch;按 name 查找 D1、不存在自动创建(支持 `CF_D1_DATABASE_ID` 指定既有库并校验);按需 `wrangler d1 migrations apply --remote`(可强制);sed 生成 wrangler.toml;可选 `CUSTOM_DOMAIN` 追加 routes;`wrangler deploy`。
- 人工步骤只有填 GH secrets。

## 3. 非功能约束

- 全程 Cloudflare 免费档: Workers 免费档(cron ≤5、subrequest 50/次调用含 D1、10 万请求/天、CPU 10ms/次偶发突发)、D1 免费档(读 500 万/写 10 万行/天)。
- models.dev 响应 ~5.3MB:靠 hash 短路保证绝大多数轮次不解析。
- §10 明确不做:变价/字段变更事件、RSS、事件清理、Cloudflare Access / better-auth / KV、渠道×全局去重、后台改 cron。

## 4. 验收标准(DECISIONS §12)

1. push 后 CI 全绿:D1 自动创建、迁移应用、worker 部署成功;人工步骤只有填 GH secrets。
2. `/setup` 走通;配完 TG 后"发送测试通知"能收到。
3. "立即运行"完成两个内置目录源首跑:静默 seed、事件表有记录(seed 记录)、/feed 可读。
4. 制造一个模型消失后两轮探测内收到 delisted;制造连续 3 次失败触发告警,恢复有通知。
5. 单元测试覆盖核心纯逻辑(cron 表达式映射边界、diff 状态机、去重、TG 分段、周报门控、鉴权);typecheck 通过。
6. 观察一周无 1027(请求超限)/CPU 超限报错(部署后人工观察项,不阻塞本任务完成)。
