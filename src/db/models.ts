/**
 * models 表读写(spec:product/storage.md 硬要求:diff 在内存做,D1 只写变化;
 * 稳定轮对 models 零写入,严禁每轮全量 upsert last_seen / last_state_change)。
 * 批量写一律 db.batch + 500 语句/批(design §4 subrequest 预算)。
 */
import type { PrevModel } from '../poll/diff';

export type ModelRow = PrevModel & { source_id: number };

/** 待插入模型(结构上与 poll/normalize 的 NormalizedModel 兼容,避免 db→poll 反向依赖) */
export interface ModelInsert {
  id: string;
  provider: string | null;
  snapshot: string | null;
}

export interface ModelChanges {
  added: ModelInsert[]; // INSERT(missing=0, first_seen=last_state_change=now)
  missingFirst: string[]; // UPDATE missing=1(首次缺席,静默)
  recovered: string[]; // UPDATE missing=0(重现复位,不报 added)
  delisted: string[]; // DELETE(判死:连续第 2 次缺席)
}

const INSERT_SQL =
  'INSERT INTO models (source_id, model_id, provider, missing, snapshot, first_seen, last_state_change) VALUES (?, ?, ?, 0, ?, ?, ?)';

/** 每源模型集读取(1 条 SQL;models 无 last_seen 字段,读取代价恒定) */
export async function loadSourceModels(db: D1Database, sourceId: number): Promise<ModelRow[]> {
  const res = await db
    .prepare(
      `SELECT source_id, model_id, provider, missing, snapshot, first_seen, last_state_change
       FROM models WHERE source_id = ?`,
    )
    .bind(sourceId)
    .all<ModelRow>();
  return res.results ?? [];
}

/** seed:全量入库,500 语句/批 */
export async function insertModels(
  db: D1Database,
  sourceId: number,
  models: ModelInsert[],
  nowIso: string,
): Promise<number> {
  if (!models.length) return 0;
  for (let i = 0; i < models.length; i += 500) {
    const stmts = models
      .slice(i, i + 500)
      .map((m) => db.prepare(INSERT_SQL).bind(sourceId, m.id, m.provider, m.snapshot, nowIso, nowIso));
    await db.batch(stmts);
  }
  return models.length;
}

/** diff 写回:增/标缺/复位/删 汇成一批(无变化则零语句) */
export async function applyModelChanges(
  db: D1Database,
  sourceId: number,
  changes: ModelChanges,
  nowIso: string,
): Promise<void> {
  const stmts: D1PreparedStatement[] = [];
  for (const a of changes.added) {
    stmts.push(db.prepare(INSERT_SQL).bind(sourceId, a.id, a.provider, a.snapshot, nowIso, nowIso));
  }
  for (const id of changes.missingFirst) {
    stmts.push(
      db
        .prepare('UPDATE models SET missing = 1, last_state_change = ? WHERE source_id = ? AND model_id = ?')
        .bind(nowIso, sourceId, id),
    );
  }
  for (const id of changes.recovered) {
    stmts.push(
      db
        .prepare('UPDATE models SET missing = 0, last_state_change = ? WHERE source_id = ? AND model_id = ?')
        .bind(nowIso, sourceId, id),
    );
  }
  for (const id of changes.delisted) {
    stmts.push(db.prepare('DELETE FROM models WHERE source_id = ? AND model_id = ?').bind(sourceId, id));
  }
  for (let i = 0; i < stmts.length; i += 500) {
    await db.batch(stmts.slice(i, i + 500));
  }
}

/** 每源当前模型数(/feed 与周报统计用) */
export async function countModelsBySource(db: D1Database): Promise<Map<number, number>> {
  const res = await db
    .prepare('SELECT source_id, COUNT(*) AS n FROM models GROUP BY source_id')
    .all<{ source_id: number; n: number }>();
  return new Map((res.results ?? []).map((r) => [r.source_id, r.n]));
}

/** 首缺未判死的模型(missing>=1)。hash 短路轮的判死确认用(spec:product/event-semantics.md:连续 2 次缺席) */
export async function findMissingModelIds(db: D1Database, sourceId: number): Promise<string[]> {
  const res = await db
    .prepare('SELECT model_id FROM models WHERE source_id = ? AND missing >= 1')
    .bind(sourceId)
    .all<{ model_id: string }>();
  return (res.results ?? []).map((r) => r.model_id);
}
