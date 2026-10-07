/**
 * settings 表:k-v,值统一存 TEXT(JSON 标量或字符串,design §3)。
 * 表极小(~20 行),getSettings 一次全量读(1 个 subrequest),saveSettings 分块 UPSERT。
 */
export type SettingsMap = Record<string, string>;

export async function getSettings(db: D1Database): Promise<SettingsMap> {
  const res = await db.prepare('SELECT k, v FROM settings').all<{ k: string; v: string }>();
  const out: SettingsMap = {};
  for (const row of res.results ?? []) out[row.k] = row.v;
  return out;
}

/**
 * 批量写。D1 单语句绑定参数上限 100,3 参数/行 → 30 行/语句。
 */
export async function saveSettings(
  db: D1Database,
  entries: Record<string, string>,
  nowIso: string = new Date().toISOString(),
): Promise<void> {
  const pairs = Object.entries(entries);
  if (!pairs.length) return;
  const CHUNK = 30;
  for (let i = 0; i < pairs.length; i += CHUNK) {
    const part = pairs.slice(i, i + CHUNK);
    const placeholders = part.map(() => '(?, ?, ?)').join(', ');
    const values: unknown[] = [];
    for (const [k, v] of part) values.push(k, v, nowIso);
    await db
      .prepare(
        `INSERT INTO settings (k, v, updated_at) VALUES ${placeholders}
         ON CONFLICT(k) DO UPDATE SET v = excluded.v, updated_at = excluded.updated_at`,
      )
      .bind(...values)
      .run();
  }
}

/** settings 值是 'true'/'1' 视为真;缺省回退 */
export function parseBool(v: string | undefined, fallback = false): boolean {
  if (v === undefined) return fallback;
  return v === 'true' || v === '1';
}

/** settings['allowlist'](JSON 字符串数组)→ string[];缺省/非法/非数组 → [](=全量,spec:product/data-sources.md) */
export function parseAllowlistSetting(raw: string | undefined): string[] {
  if (!raw) return [];
  try {
    const v: unknown = JSON.parse(raw);
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}
