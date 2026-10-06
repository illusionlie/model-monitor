# Design: LLM 模型监视器 v1

> 依据 `DECISIONS.md`。本文落实其 §11 授权的技术选型;语义层(事件/去重/调度/存储/通知契约)**不得偏离 DECISIONS.md**,冲突时以 DECISIONS.md 为准。

## 1. 技术栈与选型(DECISIONS §11 授权范围)

| 项 | 选型 | 理由 |
|---|---|---|
| 语言 | TypeScript(strict) | Workers 原生生态,类型即文档 |
| 路由 | **Hono**(轻量中间件:cookie/鉴权/JSON) | 比裸 fetch 少手写 session/cookie 解析;Workers 事实标准,开销可忽略 |
| 运行时配置 | wrangler v4(`^4`)+ ESM module syntax + `compatibility_date = 2026-09-01` | §11 自由 |
| D1 访问 | `env.DB`(D1Database binding)+ 原生 SQL,无 ORM | 免费档 subrequest 计费视角下要精确控制语句数,ORM 反而碍事 |
| 构建 | wrangler 内置 esbuild,`npm run typecheck` = `tsc --noEmit` | 单包无打包需求 |
| 测试 | vitest(纯逻辑单测;D1 用内存 stub 实现 `D1Database` 接口子集) | 不引 workers-test 全家桶,免费档逻辑都在纯函数里 |
| 时区 | `Intl.DateTimeFormat(..., { timeZone: 'Asia/Shanghai' })` 封装 `lib/time.ts` | §11 自由;不手算偏移 |
| Email | send_email binding(结构化对象 `env.SEND_EMAIL.send({to,from,subject,html,text})`)主力;Resend REST(`POST https://api.resend.com/emails`,Bearer key)后备 | DECISIONS §5;已核实 binding 只需 `[[send_email]] name = "SEND_EMAIL"`(2026-10-06 复核),收件地址不必写进 wrangler.toml,**收件人纯存 D1** |
| UI | 服务端拼 HTML 字符串 + 内联 CSS + 少量 vanilla JS(fetch 调 admin API) | §11 自由;无构建步骤,移动端可用 |

## 2. 目录结构

```
package.json / tsconfig.json / vitest.config.ts
wrangler.toml.example          # 占位符:__WORKER_NAME__ / __D1_DATABASE_ID__ / __CRON_EXPRESSION__
.gitignore / README.md
migrations/
  0001_init.sql                # §3 全部 DDL(一次性建表;后续演进再加编号)
scripts/
  cron-expr.mjs                # CLI:node scripts/cron-expr.mjs <minutes> → 打印表达式(CI 用,import src/lib/cron.ts,依赖 node≥23.6 类型剥离;CI 固定 node 24)
src/
  index.ts                     # export default { fetch, scheduled }
  app.ts                       # Hono 装配:admin/feed/setup 路由挂载
  env.ts                       # Env 类型:DB: D1Database; SEND_EMAIL?: SendEmailBinding
  lib/
    cron.ts                    # minutesToCron(minutes): string(纯函数,§3 规则)
    time.ts                    # 北京/UTC 双标注格式化、ISO 周判定、周五 21:00 门控计算
    lock.ts                    # D1 乐观锁(acquire/release,10min 过期)
    crypto.ts                  # sha256Hex、PBKDF2 hash/verify(时序安全比较)、随机 token、HMAC cookie 签名
  db/
    settings.ts                # get/set(getSettings 批量读、saveSettings 批量写)
    sources.ts                 # 源 CRUD + 状态字段更新
    models.ts                  # 每源模型集读取(1 条 SQL)、diff 写回(批量)
    events.ts                  # 事件插入(批量)、最近事件查询、周报聚合查询
  poll/
    normalize.ts               # 三类源响应 → NormalizedModel[] {id, provider, meta}
    diff.ts                    # 纯函数状态机(见 §5)
    engine.ts                  # runOnce(env):锁 → 逐源探测 → diff → 事件 → 通知 → 周报门控
  notify/
    render.ts                  # 事件 → TG HTML / Email HTML 文案(模板集中在此)
    telegram.ts                # sendMessage + 分段(≤4096 实体解析后)+ 1 msg/s 节流
    email.ts                   # send_email 主力 / Resend 后备,按 settings.email_transport
    dispatch.ts                # 通道矩阵(实时×周报)、>15 降级、失败告警/恢复通知
    weekly.ts                  # 周报构建与"本周已发"门控
  admin/
    auth.ts                    # PBKDF2 verify、cookie 签发/校验、中间件
    routes.ts                  # /setup /admin(页面+JSON API) /feed
    ui.ts                      # HTML 页面模板(布局/样式集中)
test/
  cron.test.ts  diff.test.ts  dedup.test.ts  telegram-split.test.ts
  weekly-gate.test.ts  auth.test.ts  cron-expr-cli.test.ts
.github/workflows/deploy.yml   # 见 §10
```

## 3. D1 Schema(migrations/0001_init.sql)

```sql
CREATE TABLE IF NOT EXISTS settings (
  k TEXT PRIMARY KEY,
  v TEXT NOT NULL,             -- JSON 标量或字符串
  updated_at TEXT NOT NULL     -- UTC ISO
);

CREATE TABLE IF NOT EXISTS sources (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL,          -- 'catalog' | 'channel'
  name TEXT NOT NULL,
  base_url TEXT NOT NULL,
  api_key TEXT,                -- 可空;OpenRouter 预留位
  enabled INTEGER NOT NULL DEFAULT 1,
  seed_done INTEGER NOT NULL DEFAULT 0,
  last_hash TEXT,              -- 响应体 SHA-256 hex
  last_success TEXT,           -- 最近一次探测成功(含 hash 短路)UTC ISO
  last_error TEXT,             -- 最近失败原因摘要(成功时清空)
  consecutive_failures INTEGER NOT NULL DEFAULT 0,
  fail_alerted INTEGER NOT NULL DEFAULT 0,        -- 连续≥3 已告警标记(防重复告警)
  rebaseline INTEGER NOT NULL DEFAULT 0,          -- 后台改 allowlist 后置 1:下轮静默全量重建(无事件无通知)
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS models (
  source_id INTEGER NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
  model_id TEXT NOT NULL,
  provider TEXT,               -- 目录源的 provider 前缀;渠道源可空
  missing INTEGER NOT NULL DEFAULT 0,  -- 连续缺席计数:0 在架 / 1 首次缺席(静默) / 2=判死即删行
  snapshot TEXT,               -- 富字段 JSON(pricing/context_length/created 等),仅展示用
  first_seen TEXT NOT NULL,
  last_state_change TEXT NOT NULL,  -- 仅在 added/delisted/缺席翻转时写——不每轮刷
  PRIMARY KEY (source_id, model_id)
) WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_id INTEGER NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
  source_name TEXT NOT NULL,   -- 冗余:源删除后 feed 仍可读
  kind TEXT NOT NULL,          -- 'added' | 'delisted' | 'seed' | 'source_fail' | 'source_recovered'
  model_id TEXT,               -- seed/fail 类可空
  dedup_group TEXT NOT NULL,   -- 'catalog' | 'channel:{source_id}'
  suppressed INTEGER NOT NULL DEFAULT 0,  -- 全局组内重复 added:入库但不通知
  notified INTEGER NOT NULL DEFAULT 0,    -- 是否已随某条通知发出(0=未发/静默)
  payload TEXT,                -- 富字段 JSON 快照
  detected_at TEXT NOT NULL    -- UTC ISO
);
CREATE INDEX IF NOT EXISTS idx_events_time ON events(detected_at DESC);
CREATE INDEX IF NOT EXISTS idx_events_dedup ON events(dedup_group, kind, model_id);
```

> 首次部署时 seed 两个内置目录源行(enabled=1, name='OpenRouter'/'models.dev', base_url 为对应端点)——通过 migration 直接 INSERT,保证 §12-3 "首跑即 seed"。

### settings 键清单(v1)

`setup_done`、`admin_password`(JSON:`{salt, hash, iterations}`)、`session_secret`(256bit hex,setup 时生成)、
`tg_bot_token`、`tg_chat_id`、`tg_realtime`(bool)、`tg_weekly`(bool)、
`email_transport`('send_email'|'resend')、`email_from`、`email_to`、`resend_api_key`、`email_realtime`(bool)、`email_weekly`(bool)、
`allowlist`(JSON 数组,目录源 provider 过滤,空=全量)、
`event_added_enabled`(bool,默认 true)、`event_delisted_enabled`(bool,默认 true)、
`feed_secret`(随机 hex,/feed 鉴权)、`weekly_last_sent`(ISO 周标识)、`run_lock`(JSON:`{ts, holder}`)。

## 4. 数据流(poll/engine.ts · runOnce)

```
acquire run_lock(D1 乐观锁,10min 过期;拿不到 → 直接返回,与 cron/立即运行互斥)
for source of enabled sources:          # 顺序执行,控 subrequest 与 1msg/s 节流
  fetch(base_url, api_key?)             # 1 subrequest;超时 15s(AbortSignal)
  err → consecutive_failures++;==3 且 !fail_alerted → 告警事件+TG 实时通知,fail_alerted=1
        success 时若 fail_alerted=1 → 恢复通知,清零
  sha256(body) == last_hash?            # 未变:只写 last_success(1 行 update),continue
  parse → normalize → allowlist 过滤(仅 catalog)→ Set<model_id>
  seed_done=0 → 全量入库(批量 INSERT,500/批),seed 事件 + "源 X 已接入,存量 N" 通知,seed_done=1
  rebaseline=1(后台改 allowlist 时置位)→ 忽略 last_hash 强制重解析,静默全量重建:
        live∩DB 保留(missing 复位)、live 新增静默 INSERT、DB 多余静默 DELETE——零事件零通知,复位 rebaseline=0
  else → diff(见 §5) → 批量写 models + 批量插 events
  update sources(last_hash, last_success, ...)
dispatch(notify):合并本轮全部事件 → 按通道矩阵发送(§7)
weeklyGate():周五 21:00 北京时间后首个触发且本周未发 → 周报(§8)
release run_lock
```

**subrequest 预算**(50/次上限):每源 1 fetch + ≤4 条 D1(读模型集、写 sources、批写 models、批插 events);4 个源 ≈ 20;通知 ≤3(TG 1-2 段 + 邮件 1);周报触发时 +2。峰值 ≈ 25 < 50。**新增源或改动时必须重算此账**。

**写配额**:稳定轮(hash 未变)每源仅 1 行 update(last_success)→ 4 源×48 轮 ≈ 192 行/天,远低于 10 万。

## 5. diff 状态机(poll/diff.ts,纯函数)

输入:`prev: Map<model_id, {missing, provider, snapshot, first_seen}>`、`live: Set<model_id>`、`now`。
输出:`{ added: AddedModel[], delisted: ModelId[], missingFirst: ModelId[], recovered: ModelId[] }` 及写回语句所需数据。

| 情形 | 动作 |
|---|---|
| live 有、DB 无 | `added` 事件 + INSERT 行(missing=0) |
| live 无、DB 有、missing=0 | missingFirst:UPDATE missing=1,**不发通知** |
| live 无、missing=1 | `delisted` 事件 + DELETE 行 |
| live 有、missing=1 | recovered:UPDATE missing=0(回到在架;因从未判死,**不产生 added 事件**) |
| live 有、missing=0 | 不写(不刷 last_seen——DECISIONS §4 硬要求) |

delisted 判死条件即 missing 1→2 的这次探测;30 分钟间隔下约 1 小时确认期。判死后行删除,模型重现时按新 added 处理(可能被全局组 dedup 压制——若历史上该组已报过同 model_id 的 added,保持静默,这是符合"只报第一次"的语义)。

## 6. 去重(全局目录组)

- added 事件落库前查:`events WHERE kind='added' AND model_id=? AND dedup_group='catalog'`(索引用 idx_events_dedup;**渠道源 dedup_group 恒为 `channel:{id}`,天然不参与**)。
- 命中 → 事件仍插入(suppressed=1, not notified=0),完全静默(无"另见于 X"提示)。
- 首跑 seed 不产生 added 事件,因此两个目录首跑互相不干扰;之后的增量 added 才受 dedup 约束。

## 7. 通知(notify/dispatch.ts)

- 输入:本轮全部事件 + seed/失败/恢复消息;按 `event_added_enabled` / `event_delisted_enabled` 开关过滤(suppressed 的一律不发)。
- **合并**:单轮全部事件渲染为一条消息(每源一节;单源 added >15 → 该源降级为"新增 N 个:首个、次个… 等"+ 计数,引导 /feed 看全量)。
- **TG**(`render.ts` + `telegram.ts`):HTML parse_mode;模型列表包 `<blockquote expandable>`;**按"实体解析后长度"预算分段**——实现取保守值:预转义后按 3800 字符预算切分(留实体余量),在行边界切,每段补头部;段间 `await sleep(1000)`(同 chat 1 msg/s);单段 sendMessage 失败只 console.error,不重试不阻塞其余段。
- **邮件**:transport = settings.email_transport;send_email 用结构化对象;Resend 用 `POST https://api.resend.com/emails`(Bearer resend_api_key)。发件失败 console.error 并计入 last_error 类日志,不中断 cron。
- 时间戳一律 `北京 2026-10-06 21:00 (UTC 13:00)` 双标注(`lib/time.ts` 提供)。
- 模板文案集中 `render.ts`,中文为主、模型 id/字段原文。

## 8. 周报(notify/weekly.ts)

- 门控:`lib/time.ts::weeklyDue(nowBeijing, weekly_last_sent)` —— now ≥ 本周五 21:00(Asia/Shanghai)且 weekly_last_sent ≠ 本周 ISO 周标识(如 `2026-W41`)→ 触发;发完写回。
- 内容:本周 added/delisted 计数 + 明细(长列表同样降级)、每源当前模型数、失败摘要。走各通道的 `*_weekly` 开关,**与实时开关独立**。

## 9. 后台与鉴权(admin/)

- **PBKDF2**:WebCrypto `PBKDF2-SHA256, 210_000 iter, 16B salt`,`hash` 存 hex;verify 用逐字节 XOR 常时比较(`crypto.ts::timingSafeEqual`)。
- **Session**:无状态签名 cookie `mm_session=<payload>.<hmac>`;payload = base64url(`{exp}`)(仅含过期时间,7 天),HMAC-SHA256(key=session_secret)。校验:重算 HMAC + 常时比较 + exp。HttpOnly、Secure、SameSite=Strict、Path=/。登出不设端点(改密码即换 secret 失效全部会话——secret 由密码派生流程一并重生成)。
- **路由**:
  - `GET/POST /setup`:settings 无 admin_password 时开放;设密码(+可选初始通知配置);成功后写 setup_done,永久关闭。
  - `POST /admin/login`、`POST /admin/logout`(logout=设过期 cookie,可留);
  - `GET /admin`(页面)、`GET /admin/api/state`(配置+源+最近 50 事件+每源统计)、`PUT /admin/api/settings`、`POST /admin/api/sources`、`DELETE /admin/api/sources/:id`、`POST /admin/api/run`(立即运行 → 调 runOnce;锁被占 → 409)、`POST /admin/api/test-notify`(发测试消息走已启用通道)、`POST /admin/api/feed-secret`(轮换)。
  - `GET /feed`:校验 `X-Feed-Secret` 头(常时比较)→ JSON:events(倒序 100)+ 每源 {模型数, last_success, last_error};错误 401。
- 所有 admin 写操作 POST/PUT/DELETE + cookie 校验中间件;/setup 在已初始化后一律 404。

## 10. CI(.github/workflows/deploy.yml)

- 触发:push(main)+ workflow_dispatch;inputs:`cron_minutes`(string,可选)、`force_migrations`(bool,默认 false)。
- secrets:`CF_API_TOKEN`(必需;需 Workers Scripts Write + D1 Edit + Account Read)、`CF_ACCOUNT_ID`(可选)、`WORKER_NAME`(可选,默认 `model-monitor`)、`CF_D1_DATABASE_ID`(可选,指定既有库)、`CUSTOM_DOMAIN`(可选)、`D1_NAME`(可选,默认 `{WORKER_NAME}-db`)。
- 步骤:
  1. checkout + node 24 + `npm ci`;
  2. D1 解析:有 `CF_D1_DATABASE_ID` → `wrangler d1 info` 校验存在(不存在则 fail);否则 `wrangler d1 list --json` 按 D1_NAME 查 → 无则 `wrangler d1 create` 并记录 id;
  3. 迁移:`wrangler d1 migrations list <DB> --remote` 有未应用(或 force_migrations)→ `wrangler d1 migrations apply <DB> --remote`;
  4. `node scripts/cron-expr.mjs ${{ inputs.cron_minutes }}` → CRON_EXPR(默认 `*/30`);
  5. sed wrangler.toml.example → wrangler.toml(替换 __WORKER_NAME__/__D1_DATABASE_ID__/__CRON_EXPRESSION__);
  6. `CUSTOM_DOMAIN` 非空 → 追加 `routes = ["https://<domain>/*"]`;
  7. `wrangler deploy`。
- `__WORKER_NAME__` 等 example 占位符与 §1 一致;wrangler.toml 在 .gitignore。

## 11. 错误处理与日志

- fetch 失败分类(network / HTTP 状态 / 解析)记入 sources.last_error 摘要(≤200 字符);console.log 带 `[poll] source=…`、`[notify]`、`[admin]` 前缀,供 `wrangler tail`。
- 任何单源异常不中断其余源(engine 每源 try/catch)。
- Worker 级未捕获异常:scheduled 内整体 try/catch + console.error,不让 cron 静默崩。

## 12. 测试设计(vitest,纯逻辑 + D1 stub)

- `cron.test.ts`:0/-1/''/'abc'→`*/30`;1,5,30,59;60;61→`0 */2`? →按规则 61 非 60 倍数 → 向上取整到 120 → `0 */2`;90→`0 */2`;120;720;1440→`0 0 * * *`;2000→`0 0 * * *`。
- `diff.test.ts`:五类状态迁移全覆盖(含 missing=1 重现不报 added)。
- `dedup.test.ts`:目录组第二次 added → suppressed;渠道组永不压制。
- `telegram-split.test.ts`:3800 预算切分、行边界、多段头部、空列表。
- `weekly-gate.test.ts`:周五 20:59 不发/21:00 发、周六发(本周未发)、跨周去重、北京时间边界(UTC 13:00 = 北京 21:00)。
- `auth.test.ts`:PBKDF2 正确/错误密码、篡改 cookie、过期 cookie、常时比较(不比较长度泄露)。
- `cron-expr-cli.test.ts`:execFile 跑 scripts/cron-expr.mjs 与库函数一致(空参 → `*/30`)。
