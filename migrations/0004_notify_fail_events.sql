-- notify_fail 系统级事件(任务 10-08-notify-fail-event):通知通道(TG/邮件)发送失败落库可见,
-- suppressed=1 → 永不进任何通知通道;仅出现在后台最近事件与 /feed。
-- 为什么必须去 FK:source_id=0 表示系统级(非源)事件,无对应 sources 行,而 D1 默认强制外键,
-- 保留 REFERENCES sources(id) 会在插入时直接 FOREIGN KEY constraint failed。
-- (备选方案「虚拟系统源」被否:所有源查询 / 源管理 UI / 周报 sourceNames 都要记得排除它。)

-- SQLite 修改列约束需重建表;events 数据量小(v1 不清理),经 INSERT SELECT 完整保留自增 id 与全部行。
-- 无其他表引用 events(models 只引用 sources),DROP 无阻碍;两条索引随表删除后按原名重建。

CREATE TABLE events_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_id INTEGER NOT NULL,    -- 源事件 = sources.id;系统级事件(notify_fail)= 0(已去 FK)
  source_name TEXT NOT NULL,     -- 冗余:源删除后 feed 仍可读;notify_fail 存 'telegram' / 'email'
  kind TEXT NOT NULL,            -- 'added' | 'delisted' | 'seed' | 'source_fail' | 'source_recovered' | 'notify_fail'
  model_id TEXT,                 -- seed/fail/notify_fail 类可空
  dedup_group TEXT NOT NULL,     -- 'catalog' | 'channel:{source_id}' | 'notify:{channel}'
  suppressed INTEGER NOT NULL DEFAULT 0,  -- 1 = 入库但完全静默:目录组去重命中 / notify_fail(永不进通知通道)
  notified INTEGER NOT NULL DEFAULT 0,    -- 是否已随某条通知发出(0=未发/静默)
  payload TEXT,                  -- 富字段 JSON 快照;notify_fail 存 {channel,sent,total,error}
  detected_at TEXT NOT NULL      -- UTC ISO
);
INSERT INTO events_new (id, source_id, source_name, kind, model_id, dedup_group, suppressed, notified, payload, detected_at)
SELECT id, source_id, source_name, kind, model_id, dedup_group, suppressed, notified, payload, detected_at FROM events;
DROP TABLE events;
ALTER TABLE events_new RENAME TO events;
CREATE INDEX idx_events_time ON events(detected_at DESC);
CREATE INDEX idx_events_dedup ON events(dedup_group, kind, model_id);

-- 删源行为保持不变:events 不再被 sources 的 ON DELETE CASCADE 级联,
-- 改由应用层显式删除(src/db/sources.ts::deleteChannelSource batch:先删 events 再删 sources);
-- models 行仍由自身 FK 的 CASCADE 删除(本 migration 不动 models 表)。
