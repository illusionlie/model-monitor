/**
 * events 表:事件插入(db.batch)、去重查询(全局目录组)、最近事件 / 周报区间查询。
 * v1 不清理(spec:product/storage.md)。
 */
export type EventKind = 'added' | 'delisted' | 'seed' | 'source_fail' | 'source_recovered';

export interface EventRow {
  id: number;
  source_id: number;
  source_name: string;
  kind: EventKind;
  model_id: string | null;
  dedup_group: string;
  suppressed: number;
  notified: number;
  payload: string | null;
  detected_at: string;
}

export interface EventInsert {
  source_id: number;
  source_name: string;
  kind: EventKind;
  model_id: string | null; // seed / source_fail / source_recovered 为 null
  dedup_group: string; // 'catalog' | 'channel:{source_id}'
  suppressed: number; // 1 = 已入库但完全静默(全局组内重复 added)
  notified: number; // 由通知层(B)发送后置 1
  payload: string | null; // JSON 快照
  detected_at: string; // UTC ISO
  /** 落库后的自增 id(insertEvents 回填;0/未定义 = 未知,通知层跳过标记) */
  row_id?: number;
}

const INSERT_SQL =
  'INSERT INTO events (source_id, source_name, kind, model_id, dedup_group, suppressed, notified, payload, detected_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)';

/** 批量插入(整轮事件一次 batch;500 语句/批);返回各行自增 id(顺序与入参一致,供标记 notified) */
export async function insertEvents(db: D1Database, events: EventInsert[]): Promise<number[]> {
  const ids: number[] = [];
  for (let i = 0; i < events.length; i += 500) {
    const stmts = events
      .slice(i, i + 500)
      .map((e) =>
        db
          .prepare(INSERT_SQL)
          .bind(
            e.source_id,
            e.source_name,
            e.kind,
            e.model_id,
            e.dedup_group,
            e.suppressed,
            e.notified,
            e.payload,
            e.detected_at,
          ),
      );
    const results = await db.batch(stmts);
    for (const r of results) ids.push(r?.meta?.last_row_id ?? 0);
  }
  return ids;
}

/** 通知层发送成功后标记 notified=1(90 个 id/语句,绑定参数上限 100) */
export async function markEventsNotified(db: D1Database, ids: number[]): Promise<void> {
  const uniq = ids.filter((x) => Number.isInteger(x) && x > 0);
  for (let i = 0; i < uniq.length; i += 90) {
    const part = uniq.slice(i, i + 90);
    const placeholders = part.map(() => '?').join(', ');
    await db.prepare(`UPDATE events SET notified = 1 WHERE id IN (${placeholders})`).bind(...part).run();
  }
}

/**
 * 全局目录组去重查询(spec:product/admin-and-feed.md):这些 model_id 中哪些历史上已在 catalog 组报过 added。
 * 渠道源(dedup_group='channel:{id}')不进此查询,天然永不参与去重。
 * D1 绑定参数上限 100 → IN 列表按 90 一段分块。
 */
export async function findCatalogAdds(db: D1Database, modelIds: string[]): Promise<Set<string>> {
  const out = new Set<string>();
  const uniq = [...new Set(modelIds)].filter(Boolean);
  for (let i = 0; i < uniq.length; i += 90) {
    const part = uniq.slice(i, i + 90);
    const placeholders = part.map(() => '?').join(', ');
    const res = await db
      .prepare(
        `SELECT DISTINCT model_id FROM events
         WHERE dedup_group = 'catalog' AND kind = 'added' AND model_id IN (${placeholders})`,
      )
      .bind(...part)
      .all<{ model_id: string }>();
    for (const r of res.results ?? []) out.add(r.model_id);
  }
  return out;
}

/** 最近事件(/feed 与后台用,id 倒序 = 时间倒序) */
export async function recentEvents(db: D1Database, limit = 100): Promise<EventRow[]> {
  const res = await db
    .prepare(
      `SELECT id, source_id, source_name, kind, model_id, dedup_group, suppressed, notified, payload, detected_at
       FROM events ORDER BY id DESC LIMIT ?`,
    )
    .bind(limit)
    .all<EventRow>();
  return res.results ?? [];
}

/** 区间事件(周报聚合用) */
export async function eventsBetween(db: D1Database, fromIso: string, toIso: string, limit = 1000): Promise<EventRow[]> {
  const res = await db
    .prepare(
      `SELECT id, source_id, source_name, kind, model_id, dedup_group, suppressed, notified, payload, detected_at
       FROM events WHERE detected_at >= ? AND detected_at < ? ORDER BY detected_at ASC LIMIT ?`,
    )
    .bind(fromIso, toIso, limit)
    .all<EventRow>();
  return res.results ?? [];
}
