# model-monitor · LLM 模型监视器

自用的 Cloudflare Workers 服务:定时轮询 LLM 模型目录(OpenRouter、models.dev)与自有渠道端点(任意 OpenAI 兼容 `GET {base_url}/models`),diff 出「新增 / 下架」,经 Telegram 和邮件通知;带一个密码保护的小设置后台。**全程跑在 Cloudflare 免费档**。

## 架构

```
             GitHub Actions(push main / 手动触发)
             解析或创建 D1 → 应用迁移 → 生成 wrangler.toml → wrangler deploy
                                │
                                ▼
  cron(默认 */30 分钟)──► Cloudflare Worker(TypeScript + Hono)
        │                        │                        │
        ▼                        ▼                        ▼
   轮询引擎 runOnce          /admin 后台               /feed 接口
   目录源 ×2 + 渠道源 ×N     PBKDF2 密码 + session     X-Feed-Secret 头鉴权
   SHA-256 短路 → diff       设置/源管理/立即运行/     事件列表 + 每源统计
   (新增/两次缺席判下架)     测试通知
        │                        │
        └──────────┬─────────────┘
                   ▼
        D1(settings / sources / models / events)
        —— 业务 secrets(TG token、Resend key、管理密码哈希)全存这里,不经 CI
                   │
                   ▼
        通知:Telegram(HTML,自动分段)+ 邮件(send_email 主力 / Resend 后备)
        + 周报(每周五 21:00 北京时间后的首轮触发)
```

核心语义(完整决策见 [`DECISIONS.md`](./DECISIONS.md)):

- 事件只有 `added` / `delisted`;`delisted` 需**连续 2 次**探测缺席才判死,首次缺席只内部标记;
- 去重只发生在全局目录组内:同一模型在两个目录先后出现,只报第一次;渠道源永不参与去重;
- 新源首次探测静默 seed(存量全量入库不通知);单源单轮新增 >15 个降级为摘要 + 计数;
- 响应体 hash 未变则跳过解析(models.dev ~5.3MB,免费档 CPU 10ms 的硬要求)。

## 部署

人工步骤只有「推送仓库 + 填 GitHub secrets」,其余(建库、迁移、部署)全部由 CI 完成。

### 0. 前置条件

- 一个 Cloudflare 账号(免费档即可);
- 若要收邮件通知:一个**托管在 Cloudflare DNS** 上的域名(Email 功能的前提,见第 3 步);
- 若要 Telegram 通知:一个 Bot token(`@BotFather` 创建)。

### 1. 推送仓库

创建**私有** GitHub 仓库,把本仓库推上去(分支 `main`)。push 到 `main` 即触发部署 workflow。

### 2. 创建 Cloudflare API Token

Cloudflare Dashboard → **My Profile → API Tokens → Create Token**(选自定义 Create Custom Token),最小权限:

| 权限 | 级别 | 用途 |
|---|---|---|
| Workers Scripts · Edit | Account | 部署 Worker |
| D1 · Edit | Account | 自动创建 D1 库、应用迁移 |
| Account Settings · Read | Account | wrangler 解析账号信息 |

- 若使用 `CUSTOM_DOMAIN`(Workers 自定义域,自动创建 DNS 记录与证书),额外加:Zone · Workers Routes · Edit(若部署报权限不足,再补 Zone · DNS · Edit);
- 权限名称以 Cloudflare 官方 [API token 权限文档](https://developers.cloudflare.com/fundamentals/api/reference/permissions/) 为准。

### 3. 配置 GitHub secrets

仓库 **Settings → Secrets and variables → Actions → New repository secret**:

| Secret | 必需 | 默认值 | 说明 |
|---|---|---|---|
| `CF_API_TOKEN` | **是** | — | 上一步创建的 API Token |
| `CF_ACCOUNT_ID` | 否 | wrangler 自动推断 | 账号 ID(Dashboard 首页右侧可复制);账号多于一个时必填 |
| `WORKER_NAME` | 否 | `model-monitor` | Worker 名称(决定 `*.workers.dev` 域名) |
| `D1_NAME` | 否 | `${WORKER_NAME}-db` | D1 库名;不存在时 CI 自动创建 |
| `CF_D1_DATABASE_ID` | 否 | — | 指定既有 D1 库的 database_id(CI 会校验存在);留空则按 `D1_NAME` 查找/创建 |
| `CUSTOM_DOMAIN` | 否 | — | 自定义域名(如 `monitor.example.com`),非空时配置为 Workers 自定义域:自动创建 DNS 记录与证书(证书生效约 1-2 分钟);要求该域名的 zone 已加入同一 Cloudflare 账号 |

业务密钥(Telegram token、Resend key、收件地址、管理密码)**不放进 GitHub secrets**——部署后在 `/setup` / `/admin` 里填,只存 D1。

### 4.(要收邮件才需要)在 Cloudflare 开启 Email

send_email 通道只能发往账号内「已验证目的地地址」,开通路径(2026-10 官方文档口径):

1. Cloudflare Dashboard → **Compute → Email Service → Email Routing**(旧版入口:选中域名 → Email → Email Routing);
2. **Onboard Domain**:选一个使用 Cloudflare DNS 的域名,确认自动添加的 MX / SPF / DKIM 记录;
3. 进入 **Destination Addresses**,添加你的收件邮箱,到邮箱里点 Cloudflare 发的验证链接。

详见官方文档:[Enable Email Routing](https://developers.cloudflare.com/email-routing/get-started/enable-email-routing/) · [Send email from Workers](https://developers.cloudflare.com/email-routing/email-workers/send-email-workers/)。

> 不打算用邮件通知(只用 Telegram)的话,这一步可跳过,但请把 `wrangler.toml.example` 里的 `[[send_email]]` 段注释掉——未开通 Email 的账号带着该 binding 部署会失败;或者改用 Resend 通道(在 `/admin` 里配 `email_transport = resend`)。

### 5. 触发部署

- push 到 `main` 自动触发;
- 或 Actions → **Deploy** → **Run workflow**,可填两个输入:
  - `cron_minutes`:轮询间隔(分钟)。留空 = 默认 `*/30`;映射规则:`≤59` → `*/N`;`60` → 每小时;`>60` 取整到小时档;`≥1440` → 每天;非法值兜底 `*/30`;
  - `force_migrations`:强制重跑 D1 迁移(正常情况下 CI 检测到待应用迁移才执行)。

CI 流程:校验/创建 D1 → 按需 `d1 migrations apply --remote` → 从 `wrangler.toml.example` 生成 `wrangler.toml`(替换 Worker 名 / D1 id / cron 表达式,可选配置自定义域)→ `wrangler deploy`。`wrangler.toml` 不入库(已 gitignore)。

## 初始化

1. 部署成功后访问 `https://<WORKER_NAME>.<你的子域>.workers.dev/setup`,设置管理密码并填写通知配置(Telegram token / chat id、邮件收件地址等)。**`/setup` 只在首次开放,完成后永久关闭。**
2. 进入 `/admin`(用管理密码登录):
   - 点「**立即运行**」完成两个内置目录源的首跑——首次为静默 seed(存量入库不通知),完成后「最近事件」里能看到 seed 记录;
   - 点「**发送测试通知**」确认 Telegram / 邮件链路通;
   - 在「源管理」里添加渠道源(任意 OpenAI 兼容 `{base_url}/models`,可选 Bearer key);
   - 「事件开关」「周报开关」「provider 白名单」等都在设置里。
3. `/feed` 供脚本拉取:后台可轮换 `feed_secret`,然后

   ```bash
   curl -H "X-Feed-Secret: <secret>" https://<worker>.workers.dev/feed
   ```

   返回事件列表(倒序 100 条)+ 每源统计(当前模型数 / 最近成功时间 / 最近错误)。

### 修改轮询频率

后台**不能**改 cron(v1 有意不做)。两种方式:

- **临时/单次**:Actions → Deploy → Run workflow,填 `cron_minutes`(该次部署生效);
- **持久**:改 `wrangler.toml.example` 里的 `__CRON_EXPRESSION__`(或干脆依赖每次 dispatch 传入),push 后 CI 重新生成。

## 验收清单

- [ ] push 后 CI 全绿:D1 自动创建、迁移应用、Worker 部署成功(人工步骤只有填 GH secrets);
- [ ] `/setup` 走通;配完 TG 后「发送测试通知」能收到;
- [ ] 「立即运行」完成两个内置目录源首跑:静默 seed、事件表有记录、`/feed` 可读;
- [ ] 制造一个模型消失后两轮探测内收到 delisted;制造连续 3 次失败触发告警,恢复有通知;
- [ ] 观察一周无 1027(请求超限)/ CPU 超限报错。

## 本地开发

```bash
npm install
npm run typecheck   # tsc --noEmit
npm test            # vitest,75 个用例

# 本地跑 Worker(本地 D1 = 本地 SQLite,不碰线上库):
cp wrangler.toml.example wrangler.toml
#   编辑 wrangler.toml:__WORKER_NAME__ 随意、__D1_DATABASE_ID__ 本地开发可任意填、
#   __CRON_EXPRESSION__ 随意;[[send_email]] 本地可注释掉
npx wrangler d1 migrations apply model-monitor-db --local
npm run dev         # http://localhost:8787/setup
```

## 已知边界(v1)

- 变价 / 字段变更不报;RSS、事件日志清理、后台改 cron 留待二期;
- 免费档配额:subrequest 50/次调用(D1 计入)、D1 写 10 万行/天——引擎按「hash 未变只写 1 行」设计,正常负载远低于配额;
- 事件日志 v1 不清理;
- 周报走同一 cron 内部门控(周五 21:00 北京时间后的首个触发)。
