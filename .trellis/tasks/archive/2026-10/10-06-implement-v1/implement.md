# Implement: LLM 模型监视器 v1

> 执行顺序:A → B → C → check。每阶段收尾必须跑 `npm run typecheck && npm test` 全绿才算完成。
> 阶段间有依赖(B 用 A 的 db/lib 接口,C 用全部);**每阶段开始前先读本文件与 design.md 对应章节**。

## 前置事实(2026-10-06 核实,过期重核)

- send_email binding:wrangler.toml 仅需 `[[send_email]] name = "SEND_EMAIL"`;发送用结构化对象;≤5MiB、收件人 ≤50。
- Workers 免费档:subrequest 50/次调用(D1 binding 计入);CPU 10ms/次(偶发突发可容忍)。
- Node 本机 24.19(支持 .ts 类型剥离,`scripts/cron-expr.mjs` 直接 import src/lib/cron.ts 可行)。

## Milestone A:骨架 + D1 + 轮询/diff 引擎

1. `package.json`(hono、wrangler、@cloudflare/workers-types、typescript、vitest 为 devDeps;scripts: `dev`=wrangler dev、`deploy`=wrangler deploy、`typecheck`=tsc --noEmit、`test`=vitest run)、`tsconfig.json`(strict、types: @cloudflare/workers-types + vitest/globals)、`vitest.config.ts`、`.gitignore`(node_modules、.wrangler、wrangler.toml、.dev.vars、*.log)。
2. `wrangler.toml.example`:name=`__WORKER_NAME__`、main=src/index.ts、compatibility_date=2026-09-01、`[triggers] crons=["__CRON_EXPRESSION__"]`、`[[d1_databases]] binding="DB" database_name="__D1_NAME__" database_id="__D1_DATABASE_ID__"`、`[[send_email]] name="SEND_EMAIL"`。
3. `migrations/0001_init.sql`:design §3 全部 DDL + INSERT 两个内置目录源。
4. `src/env.ts`、`src/lib/cron.ts`、`src/lib/time.ts`、`src/lib/lock.ts`、`src/lib/crypto.ts`(sha256Hex、pbkdf2Hash/verify、timingSafeEqual、hmacSign/Verify、randomToken)。
5. `src/db/*`(settings/sources/models/events;models 批量读写用 `db.batch([...prepared])` 控制语句数)。
6. `src/poll/normalize.ts`(OpenRouter `data[].id/provider=id 前缀`;models.dev `provider→models[]` 扁平化,id=`{provider}/{slug}` 若无前缀;channel `data[].id`)、`src/poll/diff.ts`(design §5 状态机,纯函数)、`src/poll/engine.ts`(runOnce:锁、逐源、hash 短路、seed、diff 写回、事件;通知与周报以接口占位 `notifyHooks?: { dispatch(events, env): Promise<void>; weekly(env): Promise<void> }`,B 阶段注入——**A 阶段 scheduled handler 已能端到端 seed**)。
7. `src/index.ts`:scheduled → runOnce。
8. 测试:`test/cron.test.ts`、`test/diff.test.ts`、`test/dedup.test.ts`(dedup 逻辑若落在 events 层则用内存 D1 stub;纯逻辑优先)。
9. **验证**:`npm install && npm run typecheck && npm test` 全绿;`npx wrangler d1 migrations apply model-monitor-db --local` 本地过(可选)。

**回滚点**:A 完成前仓库无部署意义,直接 git 层面可整体丢弃。

## Milestone B:通知层 + 后台/鉴权/Feed

1. `src/notify/render.ts`(事件→TG HTML/Email HTML;>15 降级;时间双标注)、`src/notify/telegram.ts`(分段 ≤3800 预算 + 1msg/s)、`src/notify/email.ts`(send_email / Resend 双 transport)、`src/notify/dispatch.ts`(通道矩阵、开关过滤、失败告警/恢复)、`src/notify/weekly.ts`(门控+构建)。
2. `src/admin/auth.ts`(PBKDF2 210k iter、cookie HMAC)、`src/admin/routes.ts`、`src/admin/ui.ts`(布局+页面:setup/login/admin 单页)。
3. `src/app.ts` Hono 装配(design §9 全部路由);`src/index.ts` fetch → app;engine 注入真实 notifyHooks;"立即运行" `POST /admin/api/run` 与 scheduled 互斥(同一 run_lock,占用 → 409)。
4. 测试:`test/telegram-split.test.ts`、`test/weekly-gate.test.ts`、`test/auth.test.ts`。
5. **验证**:typecheck + vitest 全绿;`npx wrangler dev` 本地起 /setup 可访问(不连远端 D1,本地 SQLite)。

**回滚点**:B 独立于 A 的引擎;若 UI 卡壳,保留 API 路由先合入,页面后补。

## Milestone C:CI + 文档 + 收尾

1. `scripts/cron-expr.mjs`(import src/lib/cron.ts;空参/非法 → `*/30`;stdout 仅表达式)。
2. `.github/workflows/deploy.yml`(design §10 全部步骤;`npm ci` 前缓存;D1 创建输出 id 提示)。
3. `README.md`:GH secrets 清单及最小 token scope、Dashboard 开 Email(Dashboard → Email → Email Routing/Workers 侧启用说明——以 2026-10 当下控制台路径为准措辞)、`/setup` 引导、验收清单(DECISIONS §12)。
4. `test/cron-expr-cli.test.ts`(execFile 对拍)。
5. **验证**:typecheck + vitest 全绿;`bash -n` 无(改为 `node --check` 无法用于 yaml,目测 + actionlint 若可用则跳过);本地 `node scripts/cron-expr.mjs` 空参 → `*/30`。

## Check(全量)

- trellis-check 对照 DECISIONS.md 逐节核对(尤其 §1 语义、§4 写放大、§5 通道矩阵、§7 CI 行为);
- 复核 subrequest 预算表(design §4)在最终代码成立;
- typecheck + vitest 全绿。

## 明确禁止

- 引入 KV / better-auth / Cloudflare Access / ORM;
- 每轮全量 upsert models.last_seen / last_state_change;
- 把业务 secrets 写进 env/wrangler.toml/GitHub secrets;
- §10 范围外功能(变价事件、RSS、清理任务、后台改 cron)。
