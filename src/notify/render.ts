/**
 * 通知文案模板(PRD 10-07-notify-diff-restyle:git diff 风格;文案集中在此,其余层不得拼消息):
 * - 每源 diffstat 段头「源名 +A -D」(仅非零计数,added 在前)+ 一个合并 diff 块:
 *   行首 `+`/`-` 即语义,不再输出「新增/下架」字样;added 在前、delisted 在后
 * - 通知头部时间两行「北京时间 … / UTC时间 …」(lib/time.ts::formatDualTimeLines);
 *   单行场景(周报「统计自 … 起」、测试通知)仍用 formatDualBeijingUtc
 * - 降级:单源 added > DEGRADE_THRESHOLD(15)→ 仅列 DEGRADE_SHOW(3)个,
 *   TG 块内末行「…其余 N 个,完整列表见 /feed」、邮件降级行「@@ 仅列前 3 个,共 N 个 · 完整列表见 /feed @@」;delisted 不降级
 * - TG:HTML parse_mode;模型 id 用 <code>;列表 <blockquote expandable>;
 *   系统消息行 ✅ 已接入(seed)/ ⚠️ 连续失败 / 🛩️ 已恢复
 * - 邮件:GitHub diff 卡片风格,样式逐元素 inline——禁 <style> 块、style 属性值内禁双引号
 *   (需要引号的字体名一律单引号);diff 行 bgcolor 属性与 style background-color 双写(Outlook 兼容);
 *   系统消息条置于 diff 区之前、按源分组;text 版与 TG 同构([接入]/[失败]/[恢复] 前缀)
 * - 富字段(name/created/release_date/context_length,来自 events.payload 的 snapshot)适当展示
 * - 入参事件应已完成通道过滤(suppressed=1 的事件绝不该出现在这里)
 */
import { formatDualBeijingUtc, formatDualTimeLines } from '../lib/time';
import type { EventInsert } from '../db/events';

/** 防刷屏阈值(spec:product/event-semantics.md):单源单轮 added 超过此数 → 降级 */
export const DEGRADE_THRESHOLD = 15;
/** 降级后仍内联展示的模型数 */
const DEGRADE_SHOW = 3;

export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** 单轮事件按源分组(保持首次出现顺序) */
export interface SourceSection {
  sourceId: number;
  sourceName: string;
  added: EventInsert[];
  delisted: EventInsert[];
  seed: EventInsert[];
  fail: EventInsert[];
  recovered: EventInsert[];
}

export function groupBySource(events: readonly EventInsert[]): SourceSection[] {
  const byId = new Map<number, SourceSection>();
  for (const e of events) {
    let sec = byId.get(e.source_id);
    if (!sec) {
      sec = {
        sourceId: e.source_id,
        sourceName: e.source_name,
        added: [],
        delisted: [],
        seed: [],
        fail: [],
        recovered: [],
      };
      byId.set(e.source_id, sec);
    }
    if (e.kind === 'added') sec.added.push(e);
    else if (e.kind === 'delisted') sec.delisted.push(e);
    else if (e.kind === 'seed') sec.seed.push(e);
    else if (e.kind === 'source_fail') sec.fail.push(e);
    else if (e.kind === 'source_recovered') sec.recovered.push(e);
  }
  return [...byId.values()];
}

// ---------- 富字段(仅展示;字段名以 poll/normalize.pickSnapshot 为契约) ----------

interface SnapshotFacts {
  name?: string;
  date?: string; // YYYY-MM-DD
  contextLength?: number;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function parseSnapshotFacts(payload: string | null): SnapshotFacts | null {
  if (!payload) return null;
  try {
    const v: unknown = JSON.parse(payload);
    if (!isRecord(v)) return null;
    const facts: SnapshotFacts = {};
    if (typeof v.name === 'string' && v.name) facts.name = v.name;
    if (typeof v.release_date === 'string' && v.release_date) facts.date = v.release_date;
    else if (typeof v.created === 'number' && Number.isFinite(v.created))
      facts.date = new Date(v.created * 1000).toISOString().slice(0, 10);
    else if (typeof v.created === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v.created))
      facts.date = v.created.slice(0, 10);
    if (typeof v.context_length === 'number' && Number.isFinite(v.context_length))
      facts.contextLength = v.context_length;
    return Object.keys(facts).length ? facts : null;
  } catch {
    return null;
  }
}

function fmtCtx(n: number): string {
  if (n >= 1_000_000) return `${Number((n / 1_000_000).toFixed(1))}M`;
  if (n >= 1000) return `${Math.round(n / 1000)}k`;
  return `${n}`;
}

/** TG added 行内容(已转义):「<code>id</code> · 显示名 · ctx 400k · 2025-08-07」;无富字段则只有 code 部分 */
function modelLineTg(modelId: string, payload: string | null): string {
  const facts = parseSnapshotFacts(payload);
  const parts: string[] = [`<code>${escapeHtml(modelId)}</code>`];
  if (facts?.name && facts.name !== modelId) parts.push(escapeHtml(facts.name));
  if (facts?.contextLength) parts.push(`ctx ${fmtCtx(facts.contextLength)}`);
  // release_date 是上游原始字符串,不做格式校验,脏数据靠转义兜底
  if (facts?.date) parts.push(escapeHtml(facts.date));
  return parts.join(' · ');
}

/** 纯文本行内容(TG 同构的 text 版):「id · 显示名 · ctx 400k · 2025-08-07」 */
function modelLinePlain(modelId: string, payload: string | null): string {
  const facts = parseSnapshotFacts(payload);
  const parts: string[] = [modelId];
  if (facts?.name && facts.name !== modelId) parts.push(facts.name);
  if (facts?.contextLength) parts.push(`ctx ${fmtCtx(facts.contextLength)}`);
  if (facts?.date) parts.push(facts.date);
  return parts.join(' · ');
}

/** 富字段部分(不含 id,纯文本):「显示名 · ctx 400k · 2025-08-07」;无 → '' */
function richFieldsPlain(modelId: string, payload: string | null): string {
  const parts = modelLinePlain(modelId, payload).split(' · ');
  return parts.length > 1 ? parts.slice(1).join(' · ') : '';
}

function seedCount(e: EventInsert): number {
  try {
    const v = JSON.parse(e.payload ?? '{}') as { count?: unknown };
    return typeof v.count === 'number' && Number.isFinite(v.count) ? v.count : 0;
  } catch {
    return 0;
  }
}

function failDetail(e: EventInsert): { consecutive: number; error: string } {
  try {
    const v = JSON.parse(e.payload ?? '{}') as { consecutive_failures?: unknown; error?: unknown };
    return {
      consecutive: typeof v.consecutive_failures === 'number' ? v.consecutive_failures : 0,
      error: typeof v.error === 'string' ? v.error : '未知原因',
    };
  } catch {
    return { consecutive: 0, error: '未知原因' };
  }
}

// ---------- 共享:diffstat 与降级 ----------

/** diffstat 计数片(仅非零,added 在前):['+2', '-1'] */
function diffstatParts(added: number, delisted: number): string[] {
  const parts: string[] = [];
  if (added > 0) parts.push(`+${added}`);
  if (delisted > 0) parts.push(`-${delisted}`);
  return parts;
}

/** 单源 added 降级判定:超过阈值 → 只展示 DEGRADE_SHOW 个,rest = 未展示数 */
function degradeInfo(addedCount: number): { degraded: boolean; rest: number } {
  return addedCount > DEGRADE_THRESHOLD
    ? { degraded: true, rest: addedCount - DEGRADE_SHOW }
    : { degraded: false, rest: 0 };
}

/** 主题行 diffstat:非零计数;全零 → 「无新增/下架」;seed 另附「 · 新源 N」 */
function diffSubject(prefix: string, added: number, delisted: number, seeded = 0): string {
  const parts = diffstatParts(added, delisted);
  const core = parts.length ? parts.join(' ') : '无新增/下架';
  return seeded > 0 ? `${prefix}:${core} · 新源 ${seeded}` : `${prefix}:${core}`;
}

// ---------- TG HTML ----------

function sectionTg(sec: SourceSection): string[] {
  const name = escapeHtml(sec.sourceName);
  const lines: string[] = [];
  for (const e of sec.seed)
    lines.push(`✅ <b>${name}</b> 已接入 · 存量 ${seedCount(e)} 个模型(静默 seed)`);
  for (const e of sec.fail) {
    const d = failDetail(e);
    lines.push(`⚠️ <b>${name}</b> 连续 ${d.consecutive} 次探测失败 · ${escapeHtml(d.error)}`);
  }
  for (const _e of sec.recovered) lines.push(`🛩️ <b>${name}</b> 探测已恢复`);
  if (sec.added.length > 0 || sec.delisted.length > 0) {
    const stats = diffstatParts(sec.added.length, sec.delisted.length).map((p) => `<b>${p}</b>`);
    if (lines.length > 0) lines.push('');
    lines.push(`<b>${name}</b> ${stats.join(' ')}`);
    const { degraded, rest } = degradeInfo(sec.added.length);
    const shown = degraded ? sec.added.slice(0, DEGRADE_SHOW) : sec.added;
    const rows: string[] = shown.map((e) => `+ ${modelLineTg(e.model_id ?? '', e.payload)}`);
    for (const e of sec.delisted) rows.push(`- <code>${escapeHtml(e.model_id ?? '')}</code>`);
    if (degraded) rows.push(`…其余 ${rest} 个,完整列表见 /feed`);
    lines.push('<blockquote expandable>', ...rows, '</blockquote>');
  }
  return lines;
}

/** 本轮全部事件(已过滤)→ 一条 TG HTML 消息 */
export function renderRoundTg(events: readonly EventInsert[], now: Date): string {
  const lines: string[] = ['📡 <b>模型监视 · 本轮变更</b>', formatDualTimeLines(now)];
  for (const sec of groupBySource(events)) lines.push('', ...sectionTg(sec));
  return lines.join('\n');
}

// ---------- Email HTML(GitHub diff 卡片,全量 inline style) ----------

export interface EmailMessage {
  subject: string;
  html: string;
  text: string;
}

/** inline 样式常量(PRD R3:style 值内禁双引号,需要引号的字体名一律单引号) */
const EMAIL_MONO_FONT = 'ui-monospace,SFMono-Regular,Menlo,Consolas,monospace';
const EMAIL_SANS_FONT = "-apple-system,system-ui,'PingFang SC','Microsoft YaHei',sans-serif";
const EMAIL_TIME_STYLE = 'color:#57606a;font-size:12px;margin:0 0 16px';
const EMAIL_BAR_STYLE =
  'margin:8px 0;padding:8px 12px;background-color:#ddf4ff;border-left:4px solid #0969da;border-radius:4px;font-size:13px';
const EMAIL_FILEHEAD_STYLE =
  'margin:16px 0 0;padding:6px 12px;background-color:#eff2f5;border-radius:6px 6px 0 0;font-size:13px';
const EMAIL_ROW_STYLE = `margin:0;padding:3px 12px;font-family:${EMAIL_MONO_FONT};font-size:12px`;

/** 邮件外壳:页面底色 div(bgcolor 双写)+ 白卡片 + 标题 + 两行时间(<br> 换行);extraLine 为周报「统计自 … 起」 */
function emailShell(title: string, now: Date, extraLine?: string): string {
  const time = formatDualTimeLines(now)
    .split('\n')
    .join('<br>');
  return (
    '<!doctype html><html><body>' +
    `<div bgcolor="#f6f8fa" style="background-color:#f6f8fa;padding:16px">` +
    `<div style="max-width:680px;margin:0 auto;background-color:#ffffff;border:1px solid #d0d7de;border-radius:8px;padding:20px;font-family:${EMAIL_SANS_FONT};color:#1f2328">` +
    `<h2 style="font-size:18px;margin:0 0 8px">${title}</h2>` +
    `<p style="${EMAIL_TIME_STYLE}">${time}${extraLine ? `<br>${extraLine}` : ''}</p>`
  );
}

/** 系统消息条(seed/fail/recovered),diff 区之前按源分组输出 */
function systemBarHtml(emoji: string, name: string, body: string): string {
  return `<p style="${EMAIL_BAR_STYLE}">${emoji} <strong>${name}</strong> ${body}</p>`;
}

/** 单源 → 系统条(bars)+ diff 块(diff)+ text 版行(text) */
function sectionEmail(sec: SourceSection): { bars: string[]; diff: string[]; text: string[] } {
  const name = escapeHtml(sec.sourceName);
  const bars: string[] = [];
  const diff: string[] = [];
  const text: string[] = [];
  for (const e of sec.seed) {
    bars.push(systemBarHtml('✅', name, `已接入 · 存量 ${seedCount(e)} 个模型(静默 seed)`));
    text.push(`[接入] ${sec.sourceName}:存量 ${seedCount(e)} 个模型(静默 seed)`);
  }
  for (const e of sec.fail) {
    const d = failDetail(e);
    bars.push(systemBarHtml('⚠️', name, `连续 ${d.consecutive} 次探测失败 · ${escapeHtml(d.error)}`));
    text.push(`[失败] ${sec.sourceName}:连续 ${d.consecutive} 次探测失败 · ${d.error}`);
  }
  for (const _e of sec.recovered) {
    bars.push(systemBarHtml('🛩️', name, '探测已恢复'));
    text.push(`[恢复] ${sec.sourceName}:探测已恢复`);
  }
  if (sec.added.length > 0 || sec.delisted.length > 0) {
    const stats = diffstatParts(sec.added.length, sec.delisted.length)
      .map((p) => (p.startsWith('+')
        ? `<span style="color:#1a7f37;font-weight:600">${p}</span>`
        : `<span style="color:#cf222e;font-weight:600">${p}</span>`))
      .join(' ');
    diff.push(`<p style="${EMAIL_FILEHEAD_STYLE}"><strong>${name}</strong> ${stats}</p>`);
    const { degraded } = degradeInfo(sec.added.length);
    const shown = degraded ? sec.added.slice(0, DEGRADE_SHOW) : sec.added;
    const rows: string[] = [];
    for (const e of shown) {
      const id = e.model_id ?? '';
      const rich = richFieldsPlain(id, e.payload);
      rows.push(
        `<p bgcolor="#e6ffec" style="${EMAIL_ROW_STYLE};background-color:#e6ffec;color:#1a7f37">+ ${escapeHtml(id)}${rich ? ` <span style="opacity:0.75">· ${escapeHtml(rich)}</span>` : ''}</p>`,
      );
    }
    for (const e of sec.delisted) {
      rows.push(
        `<p bgcolor="#ffebe9" style="${EMAIL_ROW_STYLE};background-color:#ffebe9;color:#cf222e">- ${escapeHtml(e.model_id ?? '')}</p>`,
      );
    }
    if (degraded)
      rows.push(
        `<p bgcolor="#f2f5f8" style="${EMAIL_ROW_STYLE};background-color:#f2f5f8;color:#59636e">@@ 仅列前 ${DEGRADE_SHOW} 个,共 ${sec.added.length} 个 · 完整列表见 /feed @@</p>`,
      );
    diff.push(`<div style="border-radius:0 0 6px 6px;overflow:hidden">${rows.join('')}</div>`);
    // text 版与 TG 同构(系统行与 diff 区之间空一行)
    if (text.length > 0) text.push('');
    text.push(`${sec.sourceName} ${diffstatParts(sec.added.length, sec.delisted.length).join(' ')}`);
    for (const e of shown) text.push(`+ ${modelLinePlain(e.model_id ?? '', e.payload)}`);
    for (const e of sec.delisted) text.push(`- ${e.model_id ?? ''}`);
    if (degraded)
      text.push(`@@ 仅列前 ${DEGRADE_SHOW} 个,共 ${sec.added.length} 个 · 完整列表见 /feed @@`);
  }
  return { bars, diff, text };
}

/** 本轮全部事件(已过滤)→ 一封邮件(subject/html/text) */
export function renderRoundEmail(events: readonly EventInsert[], now: Date): EmailMessage {
  const added = events.filter((e) => e.kind === 'added').length;
  const delisted = events.filter((e) => e.kind === 'delisted').length;
  const seeded = events.filter((e) => e.kind === 'seed').length;
  const bars: string[] = [];
  const diffs: string[] = [];
  const texts: string[] = [];
  for (const sec of groupBySource(events)) {
    const r = sectionEmail(sec);
    bars.push(...r.bars);
    diffs.push(...r.diff);
    texts.push('', ...r.text);
  }
  const subject = diffSubject('📡 模型监视', added, delisted, seeded);
  const html =
    emailShell('📡 模型监视 · 本轮变更', now) + bars.join('') + diffs.join('') + '</div></div></body></html>';
  const text = ['模型监视 · 本轮变更', formatDualTimeLines(now), ...texts].join('\n');
  return { subject, html, text };
}

// ---------- 周报 ----------

export interface WeeklyData {
  weekId: string; // 如 2026-W41
  fromIso: string; // 本周周一 00:00 北京(UTC ISO)
  toIso: string;
  sections: SourceSection[];
  addedCount: number;
  delistedCount: number;
  failCount: number;
  seedCount: number;
  recoveredCount: number;
  /** 每源当前在架模型数(source_id → count) */
  modelCounts: ReadonlyMap<number, number>;
  sourceNames: ReadonlyMap<number, string>;
}

/** 周报「当前在架」串(原文,「源名 N · 源名 M」):TG/HTML 侧在调用处转义,text 版直接用 */
function shelfCountsText(data: WeeklyData): string {
  return [...data.modelCounts.entries()]
    .map(([id, n]) => `${data.sourceNames.get(id) ?? `#${id}`} ${n}`)
    .join(' · ');
}

export function renderWeeklyTg(data: WeeklyData, now: Date): string {
  const lines: string[] = [
    `📊 <b>模型监视 · 周报 ${escapeHtml(data.weekId)}</b>`,
    formatDualTimeLines(now),
    `统计自 ${escapeHtml(formatDualBeijingUtc(data.fromIso))} 起`,
    '',
    `本周:新增 ${data.addedCount} · 下架 ${data.delistedCount} · 失败告警 ${data.failCount} · 新源接入 ${data.seedCount}`,
  ];
  if (data.sections.length === 0) lines.push('', '本周无新增/下架事件,一切平静 🌿');
  for (const sec of data.sections) lines.push('', ...sectionTg(sec));
  const counts = shelfCountsText(data);
  if (counts) lines.push('', `当前在架:${escapeHtml(counts)}`);
  return lines.join('\n');
}

export function renderWeeklyEmail(data: WeeklyData, now: Date): EmailMessage {
  const bars: string[] = [];
  const diffs: string[] = [];
  const texts: string[] = [];
  for (const sec of data.sections) {
    const r = sectionEmail(sec);
    bars.push(...r.bars);
    diffs.push(...r.diff);
    texts.push('', ...r.text);
  }
  const subject = diffSubject(`📊 模型监视周报 ${data.weekId}`, data.addedCount, data.delistedCount);
  const statsHtml = `<p style="font-size:13px">本周:新增 <strong>${data.addedCount}</strong> · 下架 <strong>${data.delistedCount}</strong> · 失败告警 ${data.failCount} · 新源接入 ${data.seedCount}</p>`;
  const shelfRows = [...data.modelCounts.entries()]
    .map(
      ([id, n]) =>
        `<li style="margin:2px 0">${escapeHtml(data.sourceNames.get(id) ?? `#${id}`)}:<strong>${n}</strong> 个在架</li>`,
    )
    .join('');
  const shelfHtml = shelfRows
    ? `<p style="margin:16px 0 0;padding:6px 12px;background-color:#eff2f5;border-radius:6px;font-size:13px"><strong>当前在架</strong></p><ul style="margin:0;padding:6px 0 6px 28px;font-size:13px">${shelfRows}</ul>`
    : '';
  const html =
    emailShell(
      `📊 模型监视 · 周报 ${escapeHtml(data.weekId)}`,
      now,
      `统计自 ${escapeHtml(formatDualBeijingUtc(data.fromIso))} 起`,
    ) +
    statsHtml +
    (bars.join('') + diffs.join('') || '<p>本周无新增/下架事件,一切平静 🌿</p>') +
    shelfHtml +
    '</div></div></body></html>';
  const textLines = [
    `模型监视周报 ${data.weekId}`,
    formatDualTimeLines(now),
    `统计自 ${formatDualBeijingUtc(data.fromIso)} 起`,
    `本周:新增 ${data.addedCount} · 下架 ${data.delistedCount} · 失败告警 ${data.failCount} · 新源接入 ${data.seedCount}`,
    ...texts,
  ];
  if (data.sections.length === 0) textLines.push('', '本周无新增/下架事件,一切平静 🌿');
  const counts = shelfCountsText(data);
  if (counts) textLines.push('', `当前在架:${counts}`);
  return { subject, html, text: textLines.join('\n') };
}
