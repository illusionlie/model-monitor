# Design:通知发送失败写入最近事件(notify_fail)

## 核心思路

新增事件类别 `notify_fail`,以 **suppressed=1(入库但完全静默)** 落库——复用现有静默机制,一处机制两个保证:

- `eligibleForTelegram` / `eligibleForEmail` 均过滤 `suppressed !== 1` → 失败事件**永不进任何通知通道**,「通知失败→再通知→再失败」循环在机制上不存在(PRD 需求 2);
- `recentEvents`(后台最近事件 50 / /feed 100)不过滤 suppressed → 后台**可见**(PRD 需求 1);
- `aggregateWeekly` 的 `visible = events.filter(e => e.suppressed !== 1)` → 周报**自动排除**,周报侧零改动。

## 事件形态

| 字段 | 值 | 说明 |
|---|---|---|
| kind | `notify_fail` | `EventKind` 新成员 |
| source_id | `0` | 系统级(非源)事件约定;需 migration 去 FK,见下 |
| source_name | `telegram` / `email` | 后台「源」列直接可读 |
| dedup_group | `notify:telegram` / `notify:email` | 独立于 `catalog` / `channel:*`,天然不参与目录去重查询 |
| model_id | `null` | 与 seed/fail 类一致 |
| suppressed | `1` | 静默关键 |
| notified | `0` | 从未随通知发出(语义自洽) |
| payload | `{"channel":"telegram","sent":1,"total":3,"error":"Telegram sendMessage HTTP 429"}` | error 摘要 ≤200 字符 |
| detected_at | 本轮 now | 插入晚于本轮事件,id 更大 → 最近事件置顶 |

同轮双通道都失败 → 插两条(每通道一条),互不合并。

## Migration 0004(events 表去 FK)

**为什么必须**:`events.source_id INTEGER NOT NULL REFERENCES sources(id)`,而 **D1 默认强制外键**(与本地 SQLite 相反,官方文档 sql-api/foreign-keys)。`source_id=0` 无对应 sources 行,插入会直接 `FOREIGN KEY constraint failed`。备选方案「虚拟系统源」(sources 插一行系统源)被否:所有源查询 / 源管理 UI / 周报 sourceNames 都要记得排除它,隐性契约更多。

**做法**(SQLite 改约束需重建表;events 数据量小,v1 不清理也无压力):

```sql
CREATE TABLE events_new( ...同 0001 结构,source_id INTEGER NOT NULL(无 REFERENCES),kind 注释加 'notify_fail' ... );
INSERT INTO events_new SELECT id, source_id, source_name, kind, model_id, dedup_group, suppressed, notified, payload, detected_at FROM events;
DROP TABLE events;
ALTER TABLE events_new RENAME TO events;
CREATE INDEX idx_events_time ON events(detected_at DESC);
CREATE INDEX idx_events_dedup ON events(dedup_group, kind, model_id);
```

无其他表引用 events,`DROP` 无阻碍;两条索引随表删除后重建(沿用原名)。

**删源行为保持不变**(admin UI 文案「其模型与事件记录将一并删除」是既定产品行为):FK 去掉后 events 不再被 CASCADE,`deleteChannelSource`(`src/db/sources.ts:147`)改为显式 batch:

```
[DELETE FROM events WHERE source_id = ?, DELETE FROM sources WHERE id = ? AND kind = 'channel']
```

models 行仍由自身 FK 的 CASCADE 删除(0004 不动 models 表)。行为、文案、API 语义全部不变,仅删除实现从「依赖 DB 级联」变「应用层显式」。

## 发送层:错误带出来

- `telegram.ts`:`TelegramSendResult` 增加 `errors: string[]`(逐段失败摘要,`err` 归一为 ≤200 字符字符串,不引入 engine 的 describeError——那是探测错误分类,语义不同)。`notifyTelegram` 每段 catch 时收集。
- `email.ts`:`sendEmail` 返回 `boolean` → `{ ok: boolean; error?: string }`(error 为各失败分支的既有 console.error 文案对应摘要)。调用方 3 处:dispatchRound、sendTestNotification、weekly,全部适配;`sendTestNotification` 顺带把 `error(发送失败,见日志)` 改为携带摘要(PRD 需求 5)。

## dispatchRound 判定逻辑

```
TG:attempted = tg_realtime 开 && tgConfigured && tgEvents>0
    r = notifyTelegram(...)
    if r.sent < r.total → recordNotifyFail(db,'telegram',{sent:r.sent,total:r.total,error:r.errors[0]},now)
    标记 notified 仅当 r.sent === r.total        ← 语义修正:部分失败不再谎报已通知
email:attempted = email_realtime 开 && emailConfigured && emEvents>0
    r = sendEmail(...)
    if !r.ok → recordNotifyFail(db,'email',{error:r.error},now)
    标记 notified 仅当 r.ok
```

`recordNotifyFail`(放 `notify/dispatch.ts`,SQL 走 `db/events.ts::insertEvents`):构造上表事件插入;插入本身 try/catch console.error(失败不阻塞主流程,与 markEventsNotified 同策略)。通道未启用/未配置 = 未尝试,不落事件(PRD 验收 4)。

`baseEligible` 增加 `case 'notify_fail': return false;`(suppressed 过滤之外的双保险 + switch 穷尽性)。

`weekly.ts`:TG `r.sent < r.total`、email `!r.ok` 时同样 `recordNotifyFail`(engine 在 `weekly()` 正常返回后写回门控;发送失败被本函数吞掉不抛错,门控照常标记,失败事件仅作可见性记录、量级 ≤1 条/通道/周,内容不自动重发)。

## Admin UI

- `admin/ui/admin.ts` `KINDS` 加 `notify_fail:['推送失败','t-notify_fail']`;
- `css.ts` 徽章配色复用 `--tag-fail`(与 source_fail 同为失败语义,不新增调色板项);
- 事件行备注:`kind==='notify_fail'` → `未推送(通道故障)`(避开 suppressed 通用文案「已静默(目录组去重)」的误导);其余逻辑不变;
- /feed 与 state API 零改动(字段映射是泛型的,kind 原样透传;feed 有 X-Feed-Secret 保护,失败摘要不外泄)。

## 预算重算(AGENTS.md 硬约束)

最坏一轮(全部源稳定 + 一次通知):D1 语句 = N 源 × 1 UPDATE + insertEvents 1 批 + markNotified 1 + **notify_fail ≤2(新增)** + 删源场景 batch 2(仅 admin 触发,独立调用配额);subrequest = N fetch + TG ≤3 段 + email ≤2。远低于 50/次调用,无风险。

## 兼容与回滚

- 旧代码读新数据:`groupBySource` 对未知 kind 静默忽略、`KINDS[ev.kind]||[ev.kind,'']` 兜底显示,回滚代码后历史 notify_fail 行无害;
- 新代码读旧数据:无新列无新表,零迁移;
- migration 前向执行(D1 惯例),CI 部署即应用;`wrangler d1 migrations apply model-monitor-db --local` 本地先行验证。

## 测试设计

- `dispatch.test.ts`(stub db 断言 SQL/参数):全失败 / 部分失败 / 双通道失败 → INSERT notify_fail 语句与绑定参数(source_id=0、suppressed=1、payload JSON);部分失败 → 无 markEventsNotified;未配置/未启用 → 零 INSERT;`eligibleForTelegram/Email(notify_fail) === false`。
- `telegram-split.test.ts` 或新文件:`notifyTelegram` 失败段收集 errors(mock fetch 抛错/非 2xx)。
- `weekly-gate.test.ts`:周报发送失败 → notify_fail INSERT。
- `ui.test.ts`:KINDS 徽章映射与 notify_fail 备注文案。
- migration:本地 `--local` apply + 现有回归全跑。
