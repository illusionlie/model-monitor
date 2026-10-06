-- model-monitor v1 初始 schema(design §3,DECISIONS §4:D1-only,无 KV)
-- 时间戳一律 UTC ISO 字符串;models 行只在状态变化时写(严禁每轮全量 upsert)

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
  rebaseline INTEGER NOT NULL DEFAULT 0,          -- 后台改 allowlist 后置 1:下轮静默全量重建(零事件零通知)
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

-- 内置全局目录源 ×2(DECISIONS §2):首跑即静默 seed(§12-3 验收)
INSERT INTO sources (kind, name, base_url, api_key, enabled, seed_done, created_at, updated_at)
VALUES
  ('catalog', 'OpenRouter', 'https://openrouter.ai/api/v1/models', NULL, 1, 0,
   strftime('%Y-%m-%dT%H:%M:%SZ', 'now'), strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  ('catalog', 'models.dev', 'https://models.dev/api.json', NULL, 1, 0,
   strftime('%Y-%m-%dT%H:%M:%SZ', 'now'), strftime('%Y-%m-%dT%H:%M:%SZ', 'now'));
