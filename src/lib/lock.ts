/**
 * D1 乐观锁(settings.run_lock = JSON {ts, holder},spec:product/admin-and-feed.md + product/storage.md):
 * scheduled 与「立即运行」互斥,拿不到锁直接跳过本轮。
 * 抢占条件:无锁,或已持有锁的 ts 过期(默认 10min)——用条件 UPSERT 保证原子性,
 * meta.changes=0 即被他人持有。
 */
const LOCK_KEY = 'run_lock';
const DEFAULT_TTL_MS = 10 * 60 * 1000;

export interface RunLockValue {
  ts: number; // epoch ms
  holder: string;
}

export async function acquireRunLock(
  db: D1Database,
  holder: string,
  ttlMs = DEFAULT_TTL_MS,
  now = Date.now(),
): Promise<boolean> {
  const value: RunLockValue = { ts: now, holder };
  const res = await db
    .prepare(
      `INSERT INTO settings (k, v, updated_at)
       VALUES ('${LOCK_KEY}', ?, ?)
       ON CONFLICT(k) DO UPDATE SET v = excluded.v, updated_at = excluded.updated_at
       WHERE COALESCE(CAST(json_extract(settings.v, '$.ts') AS INTEGER), 0) <= ?`,
    )
    .bind(JSON.stringify(value), new Date(now).toISOString(), now - ttlMs)
    .run();
  return (res.meta?.changes ?? 0) > 0;
}

/** 只释放自己持有的锁(失败可忽略:过期自然让位) */
export async function releaseRunLock(db: D1Database, holder: string): Promise<void> {
  await db
    .prepare(
      `DELETE FROM settings
       WHERE k = '${LOCK_KEY}' AND COALESCE(json_extract(v, '$.holder'), '') = ?`,
    )
    .bind(holder)
    .run();
}
