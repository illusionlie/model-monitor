# Implement:通知发送失败写入最近事件(notify_fail)

> 执行顺序自上而下;每步末尾的验证命令必须通过再进入下一步。禁止改 0001–0003 既有 migration;不动 spec、不 commit(由主会话统一做)。

## 1. Schema:事件类别 + migration 0004

- [ ] `src/db/events.ts`:`EventKind` 增加 `'notify_fail'`;`EventInsert` 注释更新(seed/fail/**notify_fail** 类 model_id 为 null)。
- [ ] 新建 `migrations/0004_notify_fail_events.sql`(design「Migration 0004」):events 重建去 FK(source_id 保 NOT NULL),注释更新 kind 值域,重建 `idx_events_time` / `idx_events_dedup`。
- [ ] `src/db/sources.ts::deleteChannelSource`:改为 batch `[DELETE FROM events WHERE source_id=?, DELETE FROM sources WHERE id=? AND kind='channel']`(models 仍走自身 CASCADE)。
- [ ] 验证:`npx wrangler d1 migrations apply model-monitor-db --local` 成功;手工抽查本地 events 表数据仍在、索引存在(`.schema events`)。

## 2. 发送层:错误摘要带出

- [ ] `src/notify/telegram.ts`:`TelegramSendResult` 加 `errors: string[]`;`notifyTelegram` 每段 catch 收集摘要(≤200 字符);单段失败仍不阻塞其余段(现状不变)。
- [ ] `src/notify/email.ts`:`sendEmail` 返回 `{ok: boolean; error?: string}`;所有 return false 分支补 error 摘要;catch 分支摘要化 err。
- [ ] 适配调用方:`dispatch.ts::sendTestNotification`(结果文案带摘要)、`weekly.ts`。
- [ ] 验证:`npm run typecheck`(会暴露全部漏改调用点)。

## 3. dispatchRound:失败落库 + notified 语义修正

- [ ] `src/notify/dispatch.ts`:
  - 新增 `recordNotifyFail(db, channel, detail, nowIso)`(构造 design「事件形态」的 EventInsert → `insertEvents`,try/catch console.error 不阻塞);
  - TG:`r.sent < r.total` → recordNotifyFail;标记 notified 改为仅 `r.sent === r.total`;
  - email:`!r.ok` → recordNotifyFail;标记 notified 仅 `r.ok`;
  - `baseEligible` 加 `case 'notify_fail': return false`。
- [ ] `src/notify/weekly.ts`:TG `sent < total`、email `!ok` → recordNotifyFail(env.DB 可用)。
- [ ] 验证:`npm run typecheck && npm test`。

## 4. Admin UI

- [ ] `src/admin/ui/admin.ts`:`KINDS` 加 `notify_fail:['推送失败','t-notify_fail']`;事件行备注对 notify_fail 显示 `未推送(通道故障)`(其余 suppressed 事件仍显示目录组去重文案)。
- [ ] `src/admin/ui/css.ts`:加 `.t-notify_fail`(复用 `--tag-fail`)。
- [ ] 验证:`npm test`(ui.test.ts)。

## 5. 测试补齐(与实现同批,design「测试设计」)

- [ ] dispatch.test.ts:全失败/部分失败/双通道/未配置未启用 4 组用例 + eligible 断言。
- [ ] telegram errors 收集用例(mock fetch)。
- [ ] weekly 失败落库用例。
- [ ] ui.test.ts:徽章与备注文案。

## 6. 全量验证(review gate)

- [ ] `npm run typecheck` 0 错误;
- [ ] `npm test` 全绿;
- [ ] `npm run dev` 手工冒烟:立即运行一轮(TG token 故意改错)→ 后台最近事件出现「推送失败」行,备注「未推送(通道故障)」;修正 token → 发送测试通知 ok。
- [ ] 预算复查:最坏轮 D1 语句与 subrequest 计数 ≤50(design「预算重算」)。

## 回滚点

- 代码回滚:revert 提交即可,notify_fail 历史行对旧代码无害(design「兼容与回滚」);
- migration 前向不可逆但幂等安全:events 数据经 INSERT SELECT 完整保留,去 FK 不影响任何现有读写路径。
