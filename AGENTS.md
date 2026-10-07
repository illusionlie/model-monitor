# model-monitor · Agent 指南

基于 Cloudflare Workers 的模型监测服务:定时轮询 LLM 模型目录与渠道端点,diff 出新增/下架,经 Telegram 与邮件通知,带密码保护的后台。**全程免费档**。


## 第一优先级文档(按序读)

1. **`.trellis/spec/product/`** — 产品契约的唯一权威:入口 `product/index.md`,含事件语义、数据源、调度、存储、通知、后台、部署、验收。实现与契约冲突时以契约文件为准;`non-goals.md` 是明确的"不做清单";`external-facts.md` 的外部事实带核实日期,怀疑过期先重核、别凭记忆。**新的设计与决策只写进 `.trellis/spec/`,不再建根级决策记录文件。**
2. **`.trellis/spec/backend/`** — 编码规范与 Key Gotchas。写任何代码前先读 `index.md`(含 workerd 生产环境特有的坑)。
3. `.trellis/workflow.md` — 开发流程(Trellis 任务制、提交纪律)。

## 架构速览

单 Worker(Hono + TypeScript strict + D1;无 ORM、无前端构建):

| 模块 | 职责 |
|---|---|
| `src/index.ts` / `app.ts` | 入口装配。`scheduled` 与 `/admin/api/run` 共享 `poll/engine.ts::runOnce`,靠 `run_lock` 互斥 |
| `src/lib/` | 纯工具:cron 分钟→表达式映射、北京/UTC 双标注时间、D1 乐观锁、WebCrypto(PBKDF2/HMAC/常时比较) |
| `src/db/` | D1 访问层,**SQL 只允许出现在这里**;批量写一律 `db.batch`(分块 ≤100 绑定参数) |
| `src/poll/` | 轮询引擎:`normalize`(三类源自适配)→ `diff`(纯状态机,五类迁移)→ `engine`(编排 + 目录组去重 + 失败告警) |
| `src/notify/` | 通知:文案只写在 `render.ts`;telegram 分段 + 跨消息 1msg/s 节流;email 双 transport(send_email 主力/Resend 后备);通道矩阵在 `dispatch.ts` |
| `src/admin/` | PBKDF2 + HMAC 无状态 cookie 鉴权、后台路由、服务端拼 HTML(移动端可用) |

## 硬约束(违反即 bug)

- **免费档纪律**:subrequest ≤50/次调用(**D1 语句也计入**);`models` 表无 `last_seen` 列、严禁全量 upsert;响应 hash 未变跳过解析。任何写路径改动必须重算这两笔账(算法见 `.trellis/spec/backend/database-guidelines.md`)。
- **Secrets 三分区**:业务密钥(TG token、Resend key、收件地址、密码哈希)只存 D1 `settings`;Worker env 只有 `DB` 与 `SEND_EMAIL`;GitHub secrets 只放 CF 部署凭据。
- **时间**:存储一律 UTC ISO;通知与展示一律双标注"北京 … (UTC …)"(`lib/time.ts` 提供函数,别手拼)。
- **workerd 生产 ≠ 本地**:PBKDF2 ≤100k 迭代等限制只在生产执行,`wrangler dev` 和 vitest 都不报错——"本地全绿"不等于"线上能跑",改动 WebCrypto/CPU 敏感路径要留心。
- `wrangler.toml` 是 CI 生成物不入库;仓库只有 `wrangler.toml.example`(占位符 `__WORKER_NAME__` / `__D1_NAME__` / `__D1_DATABASE_ID__` / `__CRON_EXPRESSION__`)。

## 常用命令

```bash
npm run typecheck   # tsc --noEmit;提交前必须 0 错误
npm test            # vitest run(纯逻辑单测 + 内存 D1 stub)
npm run dev         # wrangler dev(本地 D1)
npx wrangler d1 migrations apply model-monitor-db --local
node scripts/cron-expr.mjs 90    # cron 表达式生成;空参/非法 → */30
```

部署只走 CI(push main 或 workflow_dispatch,可填 `cron_minutes`)

## 测试与提交约定

- 时间/cron/分段/去重类逻辑必须有边界用例(测试清单见 `.trellis/spec/backend/quality-guidelines.md`);新行为随同一批改动补测试。
- 提交遵循 `.trellis/workflow.md` Phase 3.4:工作提交在前,bookkeeping(归档/日志)在后;不 push,由用户推。

<!-- TRELLIS:START -->
# Trellis Instructions

These instructions are for AI assistants working in this project.

This project is managed by Trellis. The working knowledge you need lives under `.trellis/`:

- `.trellis/workflow.md` — development phases, when to create tasks, skill routing
- `.trellis/spec/` — package- and layer-scoped coding guidelines (read before writing code in a given layer)
- `.trellis/workspace/` — per-developer journals and session traces
- `.trellis/tasks/` — active and archived tasks (PRDs, research, jsonl context)

If a Trellis command is available on your platform (e.g. `/trellis:finish-work`, `/trellis:continue`), prefer it over manual steps. Not every platform exposes every command.

If you're using Codex or another agent-capable tool, additional project-scoped helpers may live in:
- `.agents/skills/` — reusable Trellis skills
- `.codex/agents/` — optional custom subagents

Managed by Trellis. Edits outside this block are preserved; edits inside may be overwritten by a future `trellis update`.

<!-- TRELLIS:END -->
