/**
 * 通知文案模板(design §7/§8;文案集中在此,其余层不得拼消息):
 * - 时间戳一律双标注「北京 … (UTC …)」(lib/time.ts)
 * - 模型列表用 <blockquote expandable>(TG);单源 added > 15 → 降级摘要 + 计数引导 /feed
 * - 富字段(name/created/release_date/context_length,来自 events.payload 的 snapshot)适当展示
 * - 入参事件应已完成通道过滤(suppressed=1 的事件绝不该出现在这里)
 */
import { formatDualBeijingUtc } from '../lib/time';
import type { EventInsert } from '../db/events';

/** 防刷屏阈值(DECISIONS §1):单源单轮 added 超过此数 → 降级 */
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

/** "openai/gpt-5 · GPT-5 · ctx 400k · 2025-08-07" → TG 用(已转义) */
function modelLineTg(modelId: string, payload: string | null): string {
  const facts = parseSnapshotFacts(payload);
  const parts: string[] = [escapeHtml(modelId)];
  if (facts?.name && facts.name !== modelId) parts.push(escapeHtml(facts.name));
  if (facts?.contextLength) parts.push(`ctx ${fmtCtx(facts.contextLength)}`);
  if (facts?.date) parts.push(facts.date);
  return parts.join(' · ');
}

function modelLinePlain(modelId: string, payload: string | null): string {
  const facts = parseSnapshotFacts(payload);
  const parts: string[] = [modelId];
  if (facts?.name && facts.name !== modelId) parts.push(facts.name);
  if (facts?.contextLength) parts.push(`ctx ${fmtCtx(facts.contextLength)}`);
  if (facts?.date) parts.push(facts.date);
  return parts.join(' · ');
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

// ---------- TG HTML ----------

function addedListTg(events: EventInsert[]): string[] {
  if (!events.length) return [];
  const name = escapeHtml(events[0].source_name);
  if (events.length > DEGRADE_THRESHOLD) {
    const shown = events.slice(0, DEGRADE_SHOW);
    return [
      `<b>【${name}】</b>新增 ${events.length} 个(较多,仅摘要):`,
      '<blockquote expandable>',
      ...shown.map((e) => `• ${modelLineTg(e.model_id ?? '', e.payload)}`),
      `…其余 ${events.length - shown.length} 个,完整列表见 /feed`,
      '</blockquote>',
    ];
  }
  return [
    `<b>【${name}】</b>新增 ${events.length} 个:`,
    '<blockquote expandable>',
    ...events.map((e) => `• ${modelLineTg(e.model_id ?? '', e.payload)}`),
    '</blockquote>',
  ];
}

function delistedListTg(events: EventInsert[]): string[] {
  if (!events.length) return [];
  const name = escapeHtml(events[0].source_name);
  return [
    `<b>【${name}】</b>下架 ${events.length} 个:`,
    '<blockquote expandable>',
    ...events.map((e) => `• ${escapeHtml(e.model_id ?? '')}`),
    '</blockquote>',
  ];
}

function sectionTg(sec: SourceSection): string[] {
  const lines: string[] = [];
  for (const e of sec.seed) {
    lines.push(`✅ <b>【${escapeHtml(sec.sourceName)}】</b>已接入,存量 ${seedCount(e)} 个模型(静默 seed,不逐个通知)`);
  }
  for (const e of sec.fail) {
    const d = failDetail(e);
    lines.push(`⚠️ <b>【${escapeHtml(sec.sourceName)}】</b>连续 ${d.consecutive} 次探测失败:${escapeHtml(d.error)}`);
  }
  for (const _e of sec.recovered) {
    lines.push(`🛩️ <b>【${escapeHtml(sec.sourceName)}】</b>探测已恢复`);
  }
  lines.push(...addedListTg(sec.added));
  lines.push(...delistedListTg(sec.delisted));
  return lines;
}

/** 本轮全部事件(已过滤)→ 一条 TG HTML 消息 */
export function renderRoundTg(events: readonly EventInsert[], now: Date): string {
  const body: string[] = [];
  for (const sec of groupBySource(events)) body.push(...sectionTg(sec));
  return ['📡 <b>模型监视 · 本轮变更</b>', formatDualBeijingUtc(now), '', ...body].join('\n');
}

// ---------- Email HTML ----------

export interface EmailMessage {
  subject: string;
  html: string;
  text: string;
}

const EMAIL_STYLE =
  'body{font-family:-apple-system,system-ui,"Segoe UI",Roboto,"PingFang SC","Microsoft YaHei",sans-serif;max-width:680px;margin:0 auto;padding:16px;color:#1a1a1a}h2{font-size:18px}h3{font-size:15px;margin:18px 0 6px}ul{margin:4px 0;padding-left:20px}li{margin:2px 0;font-size:13px}code{background:#f2f2f5;padding:1px 4px;border-radius:3px;font-size:12px}.muted{color:#777;font-size:12px}.badge{display:inline-block;padding:0 6px;border-radius:8px;font-size:12px;color:#fff}.add{background:#0a7d32}.del{background:#b3261e}.warn{background:#b3691e}';

function li(modelId: string, payload: string | null, badge: string, label: string): string {
  const facts = parseSnapshotFacts(payload);
  const extra = facts ? ` <span class="muted">(${escapeHtml(modelLinePlain(modelId, payload).split(' · ').slice(1).join(' · '))})</span>` : '';
  return `<li><code>${escapeHtml(modelId)}</code> <span class="badge ${badge}">${label}</span>${extra}</li>`;
}

function sectionEmail(sec: SourceSection): { html: string; text: string } {
  const html: string[] = [];
  const text: string[] = [];
  const name = escapeHtml(sec.sourceName);
  for (const e of sec.seed) text.push(`[接入] ${sec.sourceName}:存量 ${seedCount(e)} 个模型(静默 seed)`);
  for (const e of sec.seed)
    html.push(`<h3>${name} 已接入</h3><p>存量 <strong>${seedCount(e)}</strong> 个模型(静默 seed,不逐个通知)。</p>`);
  for (const e of sec.fail) {
    const d = failDetail(e);
    text.push(`[失败] ${sec.sourceName}:连续 ${d.consecutive} 次探测失败 ${d.error}`);
    html.push(
      `<h3>⚠️ ${name} 连续 ${d.consecutive} 次探测失败</h3><p class="muted">${escapeHtml(d.error)}</p>`,
    );
  }
  for (const _e of sec.recovered) {
    text.push(`[恢复] ${sec.sourceName}:探测已恢复`);
    html.push(`<h3>🛩️ ${name} 探测已恢复</h3>`);
  }
  if (sec.added.length) {
    const shown =
      sec.added.length > DEGRADE_THRESHOLD ? sec.added.slice(0, DEGRADE_SHOW) : sec.added;
    const restNote =
      sec.added.length > DEGRADE_THRESHOLD
        ? `<p class="muted">共 ${sec.added.length} 个,仅列前 ${DEGRADE_SHOW} 个,完整列表见 /feed。</p>`
        : '';
    html.push(
      `<h3>${name} · 新增 ${sec.added.length}</h3><ul>${shown
        .map((e) => li(e.model_id ?? '', e.payload, 'add', '新增'))
        .join('')}</ul>${restNote}`,
    );
    text.push(`[新增 ${sec.added.length}] ${sec.sourceName}: ${shown.map((e) => modelLinePlain(e.model_id ?? '', e.payload)).join('; ')}${restNote ? `(共 ${sec.added.length} 个)` : ''}`);
  }
  if (sec.delisted.length) {
    html.push(
      `<h3>${name} · 下架 ${sec.delisted.length}</h3><ul>${sec.delisted
        .map((e) => li(e.model_id ?? '', e.payload, 'del', '下架'))
        .join('')}</ul>`,
    );
    text.push(
      `[下架 ${sec.delisted.length}] ${sec.sourceName}: ${sec.delisted.map((e) => e.model_id).join('; ')}`,
    );
  }
  return { html: html.join('\n'), text: text.join('\n') };
}

/** 本轮全部事件(已过滤)→ 一封邮件(subject/html/text) */
export function renderRoundEmail(events: readonly EventInsert[], now: Date): EmailMessage {
  const added = events.filter((e) => e.kind === 'added').length;
  const delisted = events.filter((e) => e.kind === 'delisted').length;
  const seeded = events.filter((e) => e.kind === 'seed').length;
  const parts: string[] = [];
  const texts: string[] = [];
  for (const sec of groupBySource(events)) {
    const r = sectionEmail(sec);
    parts.push(r.html);
    texts.push(r.text);
  }
  const ts = formatDualBeijingUtc(now);
  const subject = `📡 模型监视:新增 ${added} · 下架 ${delisted}${seeded ? ` · 新源接入 ${seeded}` : ''}`;
  const html = `<!doctype html><html><body style="${EMAIL_STYLE}"><h2>📡 模型监视 · 本轮变更</h2><p class="muted">${ts}</p>${parts.join('\n')}</body></html>`;
  const text = [`模型监视 · 本轮变更`, ts, '', ...texts].join('\n');
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

export function renderWeeklyTg(data: WeeklyData, now: Date): string {
  const lines: string[] = [
    `📊 <b>模型监视 · 周报 ${escapeHtml(data.weekId)}</b>`,
    formatDualBeijingUtc(now),
    `统计:${escapeHtml(formatDualBeijingUtc(data.fromIso))} 起`,
    '',
    `本周:新增 ${data.addedCount} · 下架 ${data.delistedCount} · 失败告警 ${data.failCount} · 新源接入 ${data.seedCount}`,
  ];
  if (data.sections.length === 0) lines.push('', '本周无新增/下架事件,一切平静 🌿');
  for (const sec of data.sections) lines.push('', ...sectionTg(sec));
  const counts = [...data.modelCounts.entries()]
    .map(([id, n]) => `${escapeHtml(data.sourceNames.get(id) ?? `#${id}`)} ${n}`)
    .join(' · ');
  if (counts) lines.push('', `当前在架:${counts}`);
  return lines.join('\n');
}

export function renderWeeklyEmail(data: WeeklyData, now: Date): EmailMessage {
  const parts: string[] = [];
  const texts: string[] = [];
  for (const sec of data.sections) {
    const r = sectionEmail(sec);
    parts.push(r.html);
    texts.push(r.text);
  }
  const ts = formatDualBeijingUtc(now);
  const subject = `📊 模型监视周报 ${data.weekId}:新增 ${data.addedCount} · 下架 ${data.delistedCount}`;
  const rows = [...data.modelCounts.entries()]
    .map(
      ([id, n]) =>
        `<li>${escapeHtml(data.sourceNames.get(id) ?? `#${id}`)}:<strong>${n}</strong> 个在架</li>`,
    )
    .join('');
  const html = `<!doctype html><html><body style="${EMAIL_STYLE}"><h2>📊 模型监视 · 周报 ${escapeHtml(data.weekId)}</h2><p class="muted">${ts}(统计自 ${escapeHtml(formatDualBeijingUtc(data.fromIso))})</p><p>本周:新增 <strong>${data.addedCount}</strong> · 下架 <strong>${data.delistedCount}</strong> · 失败告警 ${data.failCount} · 新源接入 ${data.seedCount}</p>${parts.join('\n') || '<p>本周无新增/下架事件,一切平静 🌿</p>'}${rows ? `<h3>当前在架</h3><ul>${rows}</ul>` : ''}</body></html>`;
  const text = [
    `模型监视周报 ${data.weekId}`,
    `${ts}(统计自 ${formatDualBeijingUtc(data.fromIso)})`,
    `本周:新增 ${data.addedCount} · 下架 ${data.delistedCount} · 失败告警 ${data.failCount} · 新源接入 ${data.seedCount}`,
    '',
    ...texts,
  ].join('\n');
  return { subject, html, text };
}
