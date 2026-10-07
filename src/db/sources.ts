/** sources 表:源行读取 + 状态字段更新(单条 UPDATE,控语句数)。 */
export type SourceKind = 'catalog' | 'channel';

export interface SourceRow {
  id: number;
  kind: SourceKind;
  name: string;
  base_url: string;
  api_key: string | null;
  extra_headers: string | null; // 渠道自定义请求头 JSON 对象字符串,NULL/空 = 无
  enabled: number;
  seed_done: number;
  last_hash: string | null;
  last_success: string | null;
  last_error: string | null;
  consecutive_failures: number;
  fail_alerted: number;
  rebaseline: number; // 1 = 下轮静默全量重建(后台改 allowlist 触发)
  created_at: string;
  updated_at: string;
}

export async function listEnabledSources(db: D1Database): Promise<SourceRow[]> {
  const res = await db.prepare('SELECT * FROM sources WHERE enabled = 1 ORDER BY id').all<SourceRow>();
  return res.results ?? [];
}

/** 后台 /feed 用:全部源(含停用) */
export async function listAllSources(db: D1Database): Promise<SourceRow[]> {
  const res = await db.prepare('SELECT * FROM sources ORDER BY id').all<SourceRow>();
  return res.results ?? [];
}

export async function getSource(db: D1Database, id: number): Promise<SourceRow | null> {
  const res = await db.prepare('SELECT * FROM sources WHERE id = ?').bind(id).first<SourceRow>();
  return res ?? null;
}

export interface SourceStatusPatch {
  last_hash?: string | null;
  last_success?: string | null;
  last_error?: string | null; // null = 清空
  consecutive_failures?: number;
  fail_alerted?: number;
  seed_done?: number;
  rebaseline?: number;
}

/** 只更新给出的字段,1 条语句;updated_at 必写。 */
export async function updateSourceStatus(
  db: D1Database,
  id: number,
  patch: SourceStatusPatch,
  nowIso: string,
): Promise<void> {
  const sets: string[] = [];
  const values: unknown[] = [];
  if ('last_hash' in patch) {
    sets.push('last_hash = ?');
    values.push(patch.last_hash);
  }
  if ('last_success' in patch) {
    sets.push('last_success = ?');
    values.push(patch.last_success);
  }
  if ('last_error' in patch) {
    sets.push('last_error = ?');
    values.push(patch.last_error);
  }
  if (patch.consecutive_failures !== undefined) {
    sets.push('consecutive_failures = ?');
    values.push(patch.consecutive_failures);
  }
  if (patch.fail_alerted !== undefined) {
    sets.push('fail_alerted = ?');
    values.push(patch.fail_alerted);
  }
  if (patch.seed_done !== undefined) {
    sets.push('seed_done = ?');
    values.push(patch.seed_done);
  }
  if (patch.rebaseline !== undefined) {
    sets.push('rebaseline = ?');
    values.push(patch.rebaseline);
  }
  if (!sets.length) return;
  sets.push('updated_at = ?');
  values.push(nowIso, id);
  await db.prepare(`UPDATE sources SET ${sets.join(', ')} WHERE id = ?`).bind(...values).run();
}

/** 后台新增渠道源(spec:product/data-sources.md);seed_done=0 → 下轮探测即静默 seed */
export async function createChannelSource(
  db: D1Database,
  input: { name: string; base_url: string; api_key?: string | null; extra_headers?: string | null },
  nowIso: string,
): Promise<number> {
  const res = await db
    .prepare(
      `INSERT INTO sources (kind, name, base_url, api_key, extra_headers, enabled, seed_done, created_at, updated_at)
       VALUES ('channel', ?, ?, ?, ?, 1, 0, ?, ?)`,
    )
    .bind(input.name, input.base_url, input.api_key ?? null, input.extra_headers ?? null, nowIso, nowIso)
    .run();
  return res.meta?.last_row_id ?? 0;
}

export interface ChannelSourcePatch {
  name?: string;
  base_url?: string;
  api_key?: string | null; // null = 清空
  extra_headers?: string | null; // null = 清空
}

/** 渠道编辑(路由层已守卫 kind='channel'):只更新给出的字段,api_key/extra_headers 用 in 区分"清空"与"不修改";1 条语句,updated_at 必写。 */
export async function updateChannelSource(
  db: D1Database,
  id: number,
  patch: ChannelSourcePatch,
  nowIso: string,
): Promise<void> {
  const sets: string[] = [];
  const values: unknown[] = [];
  if (patch.name !== undefined) {
    sets.push('name = ?');
    values.push(patch.name);
  }
  if (patch.base_url !== undefined) {
    sets.push('base_url = ?');
    values.push(patch.base_url);
  }
  if ('api_key' in patch) {
    sets.push('api_key = ?');
    values.push(patch.api_key ?? null);
  }
  if ('extra_headers' in patch) {
    sets.push('extra_headers = ?');
    values.push(patch.extra_headers ?? null);
  }
  if (!sets.length) return;
  sets.push('updated_at = ?');
  values.push(nowIso, id);
  await db.prepare(`UPDATE sources SET ${sets.join(', ')} WHERE id = ?`).bind(...values).run();
}

/** 删除渠道源;内置目录源(migration 预置)不允许删,保持 v1 语义稳定 */
export async function deleteChannelSource(db: D1Database, id: number): Promise<void> {
  await db.prepare(`DELETE FROM sources WHERE id = ? AND kind = 'channel'`).bind(id).run();
}

/**
 * 清理源存量模型(渠道与目录源均可用):删该源全部 models 行,并复位 seed 状态
 * (seed_done=0 / last_hash=NULL / rebaseline=0)→ 下轮探测按新源路径静默 seed,仅一条接入确认事件。
 * 非破坏性:源配置(base_url/key/启停)与 events 审计记录均不动。
 */
export async function resetSourceModels(db: D1Database, id: number, nowIso: string): Promise<void> {
  await db.batch([
    db.prepare('DELETE FROM models WHERE source_id = ?').bind(id),
    db.prepare('UPDATE sources SET seed_done = 0, last_hash = NULL, rebaseline = 0, updated_at = ? WHERE id = ?').bind(nowIso, id),
  ]);
}

/** 启停源(内置目录源只可启停不可删,spec:product/admin-and-feed.md) */
export async function setSourceEnabled(
  db: D1Database,
  id: number,
  enabled: boolean,
  nowIso: string,
): Promise<void> {
  await db
    .prepare('UPDATE sources SET enabled = ?, updated_at = ? WHERE id = ?')
    .bind(enabled ? 1 : 0, nowIso, id)
    .run();
}

/** 后台改 allowlist → 全部目录源置 rebaseline=1(下轮静默全量重建);返回受影响行数 */
export async function markCatalogsRebaseline(db: D1Database, nowIso: string): Promise<number> {
  const res = await db
    .prepare(`UPDATE sources SET rebaseline = 1, updated_at = ? WHERE kind = 'catalog'`)
    .bind(nowIso)
    .run();
  return res.meta?.changes ?? 0;
}
