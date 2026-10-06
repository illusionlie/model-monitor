// cron_minutes → cron 表达式(DECISIONS §3 映射规则,纯函数)。
//
// - 空缺 / 非法 / ≤0 / 非整数 → 兜底 "*/30 * * * *"
// - 1..59            → "*/N * * * *"(整点重置导致的间隔抖动可接受)
// - 60               → "0 * * * *"
// - >60 且为 60 倍数  → "0 */H * * *"
// - >60 非倍数       → 向上取整到小时档
// - ≥1440            → "0 0 * * *"(按天)
//
// CI 经 scripts/cron-expr.mjs(Milestone C)调用;此处只做纯映射。
// 注意:块注释中不能出现字面 "*/",故本文件头部用行注释。
export const FALLBACK_CRON = '*/30 * * * *';

export function minutesToCron(input: unknown): string {
  // 只接受 number / string;布尔、对象等一律非法
  if (typeof input !== 'number' && typeof input !== 'string') return FALLBACK_CRON;
  const raw = typeof input === 'string' ? input.trim() : input;
  if (raw === '') return FALLBACK_CRON;

  const n = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n <= 0) return FALLBACK_CRON;

  const minutes = Math.min(n, 1440);
  if (minutes <= 59) return `*/${minutes} * * * *`;
  if (minutes === 60) return '0 * * * *';

  const hours = Math.ceil(minutes / 60);
  if (hours >= 24) return '0 0 * * *';
  return `0 */${hours} * * *`;
}
