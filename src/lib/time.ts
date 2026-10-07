/**
 * 时间工具(spec:product/scheduling.md):
 * - 存储一律 UTC ISO;展示层双标注「北京 … (UTC …)」
 * - 周报门控:每周五 21:00(Asia/Shanghai)后首个触发且本周未发
 *
 * 北京时间用 Intl 取墙钟,再映射到「naive UTC 毫秒」帧做日期运算——
 * 中国无夏令时,+08:00 固定偏移,该帧内加减天数是精确的(spec:product/index.md 非契约自由度授权)。
 */
const BEIJING_TZ = 'Asia/Shanghai';

interface WallClock {
  year: number;
  month: number; // 1..12
  day: number; // 1..31
  hour: number; // 0..23
  minute: number; // 0..59
  weekday: number; // 0=周日 … 6=周六(与 Date.getDay 一致)
}

const beijingFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: BEIJING_TZ,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
  weekday: 'short',
});

const WEEKDAY_INDEX: Record<string, number> = {
  Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
};

/** 取某时刻的北京墙钟分量 */
function beijingWallClock(date: Date): WallClock {
  const parts = beijingFormatter.formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((p) => p.type === type)?.value ?? '';
  let hour = Number(get('hour'));
  if (hour === 24) hour = 0; // 个别 ICU 版本以 24:00 表示午夜
  return {
    year: Number(get('year')),
    month: Number(get('month')),
    day: Number(get('day')),
    hour,
    minute: Number(get('minute')),
    weekday: WEEKDAY_INDEX[get('weekday')] ?? -1,
  };
}

const pad2 = (n: number): string => String(n).padStart(2, '0');

/** 通知消息时间戳双标注:北京 2026-10-06 21:00 (UTC 13:00) */
export function formatDualBeijingUtc(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  const wc = beijingWallClock(d);
  return `北京 ${wc.year}-${pad2(wc.month)}-${pad2(wc.day)} ${pad2(wc.hour)}:${pad2(wc.minute)} (UTC ${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())})`;
}

/** ISO 周标识(周一为一周开始),如 `2026-W41`。输入是「naive UTC 毫秒」帧内的时间。 */
function isoWeekOfNaive(naiveMs: number): string {
  const dayNum = new Date(naiveMs).getUTCDay() || 7; // ISO 星期:Mon=1..Sun=7
  const thursday = naiveMs + (4 - dayNum) * 86_400_000; // 就近周四定周归属年
  const year = new Date(thursday).getUTCFullYear();
  const yearStart = Date.UTC(year, 0, 1);
  const week = Math.floor((thursday - yearStart) / 604_800_000) + 1;
  return `${year}-W${pad2(week)}`;
}

/** 北京墙钟 → naive UTC 毫秒(仅用于同帧内的墙钟日期运算);mondayMidnight = 本周周一 00:00 的 naive 值 */
function beijingNaiveMs(date: Date): { naive: number; mondayMidnight: number } {
  const wc = beijingWallClock(date);
  const naive = Date.UTC(wc.year, wc.month - 1, wc.day, wc.hour, wc.minute, 0);
  const isoDow = ((wc.weekday + 6) % 7) + 1; // Mon=1..Sun=7
  const mondayMidnight = Date.UTC(wc.year, wc.month - 1, wc.day) - (isoDow - 1) * 86_400_000;
  return { naive, mondayMidnight };
}

/** 当前时刻所属北京 ISO 周,如 `2026-W41` */
export function beijingWeekId(date: Date): string {
  return isoWeekOfNaive(beijingNaiveMs(date).mondayMidnight);
}

/**
 * 周报门控:now ≥ 本周五 21:00(北京时间)且 weekly_last_sent ≠ 本周标识
 * → 返回本周标识(调用方发完写回 settings.weekly_last_sent);否则返回 null。
 */
export function weeklyDue(now: Date, lastSentWeekId: string | null | undefined): string | null {
  const { naive, mondayMidnight } = beijingNaiveMs(now);
  const fridayDeadline = mondayMidnight + 4 * 86_400_000 + 21 * 3_600_000; // 本周五 21:00 整(naive)
  if (naive < fridayDeadline) return null;
  const weekId = isoWeekOfNaive(mondayMidnight);
  return weekId === lastSentWeekId ? null : weekId;
}

/** 本周周一 00:00(北京)对应的真实 UTC 时刻——周报统计窗口起点(naive − 8h 固定偏移) */
export function beijingWeekStart(date: Date): Date {
  return new Date(beijingNaiveMs(date).mondayMidnight - 8 * 3_600_000);
}
