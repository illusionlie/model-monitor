/**
 * 轮询引擎 runOnce(design §4 数据流):
 * 锁 → 逐源探测(顺序执行,控 subrequest)→ hash 短路 → seed / rebaseline / diff → 事件批量落库 → 通知钩子 → 周报门控 → 释放锁。
 *
 * 每源 D1 语句预算 ≤ ~6(fetch 1 + 读模型集 1 + dedup 查询 0..1 + models 写回批 0..1 + sources 更新 1),
 * 整轮事件一次 batch;稳定轮(hash 未变)每源仅 1 行 UPDATE sources.last_success。
 *
 * 通知与周报在本阶段是可注入接口(notifyHooks),Milestone B 接入真实实现;
 * A 阶段事件先行落库(含 source_fail / source_recovered / seed)。
 */
import type { Env } from '../env';
import { sha256Hex } from '../lib/crypto';
import { acquireRunLock, releaseRunLock } from '../lib/lock';
import { weeklyDue } from '../lib/time';
import { getSettings, parseAllowlistSetting, saveSettings, type SettingsMap } from '../db/settings';
import { listEnabledSources, updateSourceStatus, type SourceRow } from '../db/sources';
import { applyModelChanges, insertModels, loadSourceModels, findMissingModelIds } from '../db/models';
import { findCatalogAdds, insertEvents, type EventInsert, type EventKind } from '../db/events';
import { applyAllowlist, normalizeResponse, ResponseParseError, type NormalizedModel } from './normalize';
import { diffModels } from './diff';

/** B 阶段注入:dispatch 拿到本轮全部事件(含 seed/fail/recovered)与 settings 快照,自做开关过滤与合并 */
export interface NotifyHooks {
  dispatch(events: EventInsert[], settings: SettingsMap): Promise<void>;
  weekly(): Promise<void>;
}

export interface RunOptions {
  holder?: string; // 'cron' | 'manual'(立即运行)
  now?: Date; // 测试注入
  notifyHooks?: NotifyHooks;
}

export type SourceOutcome = 'seeded' | 'changed' | 'unchanged' | 'failed' | 'rebaselined';

export interface SourceRunResult {
  sourceId: number;
  sourceName: string;
  outcome: SourceOutcome;
  fetched: boolean;
  seedCount?: number;
  added?: number;
  delisted?: number;
  suppressed?: number;
  missingFirst?: number;
  recovered?: number;
  error?: string;
  consecutiveFailures?: number;
}

export interface RunSummary {
  locked: boolean; // true = run_lock 被占用,本轮跳过
  startedAt: string;
  sources: SourceRunResult[];
  eventsInserted: number;
  weeklySent: string | null; // 本次标记的 ISO 周标识(null = 未触发/未注入钩子)
}

const FETCH_TIMEOUT_MS = 15_000;
const FAIL_ALERT_THRESHOLD = 3; // 连续 3 次探测失败 → source_fail + fail_alerted(DECISIONS §5)

class HttpProbeError extends Error {
  constructor(readonly status: number) {
    super(`HTTP ${status}`);
  }
}

async function fetchBody(src: SourceRow): Promise<ArrayBuffer> {
  const headers: Record<string, string> = { accept: 'application/json' };
  if (src.api_key) headers.authorization = `Bearer ${src.api_key}`;
  const res = await fetch(src.base_url, { headers, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  if (!res.ok) throw new HttpProbeError(res.status);
  return res.arrayBuffer();
}

/** 失败分类摘要(design §11:network / HTTP 状态 / 解析,≤200 字符) */
function describeError(err: unknown): string {
  let msg: string;
  if (err instanceof HttpProbeError) msg = `[http] ${err.status}`;
  else if (err instanceof ResponseParseError) msg = `[parse] ${err.message}`;
  else if (err instanceof Error)
    msg = `[network] ${err.name === 'TimeoutError' || err.name === 'AbortError' ? `timeout after ${FETCH_TIMEOUT_MS}ms` : `${err.name}: ${err.message}`}`;
  else msg = `[network] ${String(err)}`;
  return msg.length > 200 ? `${msg.slice(0, 197)}...` : msg;
}

function dedupGroupOf(src: SourceRow): string {
  return src.kind === 'catalog' ? 'catalog' : `channel:${src.id}`;
}function makeEvent(
  src: SourceRow,
  kind: EventKind,
  modelId: string | null,
  payload: string | null,
  detectedAt: string,
  suppressed = 0,
): EventInsert {
  return {
    source_id: src.id,
    source_name: src.name,
    kind,
    model_id: modelId,
    dedup_group: dedupGroupOf(src),
    suppressed,
    notified: 0,
    payload,
    detected_at: detectedAt,
  };
}

/**
 * 全局目录组去重(DECISIONS §1/§6,纯函数,单测覆盖):
 * 只对 dedup_group='catalog' 的 added 生效;历史已报过同 model_id → suppressed=1(入库但完全静默)。
 * 渠道组(channel:*)与其他事件类别永不受影响。返回压制条数。
 */
export function applyCatalogDedup(
  events: EventInsert[],
  reportedCatalogModelIds: ReadonlySet<string>,
): number {
  let count = 0;
  for (const e of events) {
    if (
      e.kind === 'added' &&
      e.dedup_group === 'catalog' &&
      e.model_id !== null &&
      reportedCatalogModelIds.has(e.model_id)
    ) {
      e.suppressed = 1;
      count++;
    }
  }
  return count;
}

/** 探测失败:计数 +1;连续≥3 且未告警过 → source_fail 事件 + fail_alerted=1(实际发送由 B 的 hooks 完成) */
async function recordFailure(
  db: D1Database,
  src: SourceRow,
  error: string,
  nowIso: string,
  roundEvents: EventInsert[],
): Promise<SourceRunResult> {
  const consecutive = src.consecutive_failures + 1;
  let failAlerted = src.fail_alerted;
  if (consecutive >= FAIL_ALERT_THRESHOLD && failAlerted !== 1) {
    failAlerted = 1;
    roundEvents.push(
      makeEvent(src, 'source_fail', null, JSON.stringify({ consecutive_failures: consecutive, error }), nowIso),
    );
  }
  await updateSourceStatus(
    db,
    src.id,
    { last_error: error, consecutive_failures: consecutive, fail_alerted: failAlerted },
    nowIso,
  );
  console.error(`[poll] source=${src.name} failed(consecutive=${consecutive}): ${error}`);
  return {
    sourceId: src.id,
    sourceName: src.name,
    outcome: 'failed',
    fetched: false,
    error,
    consecutiveFailures: consecutive,
  };
}

/** 探测成功(含 hash 短路):失败计数清零;若此前已告警 → source_recovered 事件 */
function recoveryPatch(
  src: SourceRow,
  roundEvents: EventInsert[],
  nowIso: string,
): { consecutive_failures: number; fail_alerted: number; last_error: null } {
  if (src.fail_alerted === 1) {
    roundEvents.push(makeEvent(src, 'source_recovered', null, null, nowIso));
  }
  return { consecutive_failures: 0, fail_alerted: 0, last_error: null };
}

async function pollSource(
  db: D1Database,
  src: SourceRow,
  settings: SettingsMap,
  nowIso: string,
  roundEvents: EventInsert[],
  roundCatalogAdds: Set<string>,
): Promise<SourceRunResult> {
  const base: SourceRunResult = { sourceId: src.id, sourceName: src.name, outcome: 'failed', fetched: false };

  // 1) fetch(1 subrequest;超时 15s)
  let buf: ArrayBuffer;
  try {
    buf = await fetchBody(src);
  } catch (err) {
    return recordFailure(db, src, describeError(err), nowIso, roundEvents);
  }
  base.fetched = true;

  // 2) body hash 短路(硬要求:hash 未变 → 不解析,models 零写入)
  //    rebaseline=1 时忽略 last_hash 强制重解析(后台改 allowlist 后需按新口径重建)
  const hash = await sha256Hex(buf);
  if (src.seed_done === 1 && src.rebaseline !== 1 && hash === src.last_hash) {
    const patch = recoveryPatch(src, roundEvents, nowIso);
    // 判死确认(DECISIONS §1 连续 2 次缺席):hash 未变 ⇒ live 集与上次解析完全一致,
    // 上次首缺的模型本次探测仍缺席 → 第 2 次,判死。稳定源无 missing 行时零写回。
    const pending = await findMissingModelIds(db, src.id);
    let delisted = 0;
    if (pending.length > 0) {
      await applyModelChanges(db, src.id, { added: [], missingFirst: [], recovered: [], delisted: pending }, nowIso);
      for (const id of pending) roundEvents.push(makeEvent(src, 'delisted', id, null, nowIso));
      delisted = pending.length;
    }
    await updateSourceStatus(db, src.id, { ...patch, last_success: nowIso }, nowIso);
    console.log(`[poll] source=${src.name} unchanged(hash 命中${delisted ? `,判死 ${delisted} 个` : ''})`);
    return {
      ...base,
      outcome: delisted > 0 ? 'changed' : 'unchanged',
      delisted,
    };
  }

  // 3) 解析(仅 hash 变化/首跑时)。空集视为解析失败,防止响应结构变化导致全量误判 delisted
  let parsed: NormalizedModel[] | null = null;
  let parseError: string | null = null;
  try {
    const text = new TextDecoder().decode(buf);
    parsed = normalizeResponse(src.kind, text);
    if (parsed.length === 0) {
      throw new ResponseParseError('解析得到 0 个模型(疑似响应结构变化),按失败处理');
    }
  } catch (err) {
    parseError = describeError(err);
  }
  if (parseError !== null || parsed === null) {
    return recordFailure(db, src, parseError ?? '[parse] 未知错误', nowIso, roundEvents);
  }
  const models =
    src.kind === 'catalog' ? applyAllowlist(parsed, parseAllowlistSetting(settings['allowlist'])) : parsed;
  const byId = new Map(models.map((m) => [m.id, m]));
  const patch = recoveryPatch(src, roundEvents, nowIso);

  // 4a) 新源首跑:静默 seed(全量入库、无 added 事件,只有一条 seed 事件供"源 X 已接入,存量 N"通知)
  if (src.seed_done !== 1) {
    const count = await insertModels(db, src.id, models, nowIso);
    roundEvents.push(makeEvent(src, 'seed', null, JSON.stringify({ count }), nowIso));
    await updateSourceStatus(
      db,
      src.id,
      { ...patch, last_success: nowIso, last_hash: hash, seed_done: 1, rebaseline: 0 },
      nowIso,
    );
    console.log(`[poll] source=${src.name} seeded(${count} 个模型)`);
    return { ...base, outcome: 'seeded', seedCount: count };
  }

  // 4b) rebaseline=1(后台改 allowlist):静默全量重建——
  //     live∩DB 保留并复位 missing、live 新增静默 INSERT、DB 多余静默 DELETE;零事件零通知
  if (src.rebaseline === 1) {
    const rows = await loadSourceModels(db, src.id);
    const dbIds = new Set(rows.map((r) => r.model_id));
    const liveIds = new Set(models.map((m) => m.id));
    const inserts = models.filter((m) => !dbIds.has(m.id));
    const removeIds = rows.filter((r) => !liveIds.has(r.model_id)).map((r) => r.model_id);
    const resetIds = rows
      .filter((r) => liveIds.has(r.model_id) && r.missing !== 0)
      .map((r) => r.model_id);
    await applyModelChanges(
      db,
      src.id,
      { added: inserts, missingFirst: [], recovered: resetIds, delisted: removeIds },
      nowIso,
    );
    await updateSourceStatus(
      db,
      src.id,
      { ...patch, last_success: nowIso, last_hash: hash, rebaseline: 0 },
      nowIso,
    );
    console.log(
      `[poll] source=${src.name} rebaseline 重建(insert=${inserts.length} delete=${removeIds.length} reset=${resetIds.length},零事件零通知)`,
    );
    return { ...base, outcome: 'rebaselined' };
  }

  // 4b) diff(1 条读)→ 写回(1 批)→ 事件
  const rows = await loadSourceModels(db, src.id);
  const prev = new Map(rows.map((r) => [r.model_id, r]));
  const live = new Set(models.map((m) => m.id));
  const d = diffModels(prev, live);

  if (d.added.length || d.missingFirst.length || d.recovered.length || d.delisted.length) {
    await applyModelChanges(
      db,
      src.id,
      {
        added: d.added.map((id) => {
          const m = byId.get(id);
          return { id, provider: m?.provider ?? null, snapshot: m?.snapshot ?? null };
        }),
        missingFirst: d.missingFirst,
        recovered: d.recovered,
        delisted: d.delisted,
      },
      nowIso,
    );
  }

  const newEvents: EventInsert[] = [];
  for (const id of d.added) {
    newEvents.push(makeEvent(src, 'added', id, byId.get(id)?.snapshot ?? null, nowIso));
  }
  for (const id of d.delisted) {
    newEvents.push(makeEvent(src, 'delisted', id, null, nowIso));
  }
  let suppressed = 0;
  if (src.kind === 'catalog' && newEvents.length > 0) {
    const addedIds = newEvents.filter((e) => e.kind === 'added').map((e) => e.model_id as string);
    if (addedIds.length > 0) {
      // 历史(已落库)∪ 本轮更早源的去重集合——DECISIONS §1 "只报第一次"覆盖同轮场景
      const reported = await findCatalogAdds(db, addedIds);
      for (const id of roundCatalogAdds) reported.add(id);
      suppressed = applyCatalogDedup(newEvents, reported);
      for (const id of addedIds) roundCatalogAdds.add(id);
    }
  }
  roundEvents.push(...newEvents);
  await updateSourceStatus(db, src.id, { ...patch, last_success: nowIso, last_hash: hash }, nowIso);
  console.log(
    `[poll] source=${src.name} changed(added=${d.added.length} delisted=${d.delisted.length} missingFirst=${d.missingFirst.length} recovered=${d.recovered.length} suppressed=${suppressed})`,
  );
  return {
    ...base,
    outcome: 'changed',
    added: d.added.length,
    delisted: d.delisted.length,
    missingFirst: d.missingFirst.length,
    recovered: d.recovered.length,
    suppressed,
  };
}

export async function runOnce(env: Env, opts: RunOptions = {}): Promise<RunSummary> {
  const db = env.DB;
  const holder = opts.holder ?? 'cron';
  const now = opts.now ?? new Date();
  const nowIso = now.toISOString();

  const acquired = await acquireRunLock(db, holder);
  if (!acquired) {
    console.log('[poll] run_lock 被占用,跳过本轮');
    return { locked: true, startedAt: nowIso, sources: [], eventsInserted: 0, weeklySent: null };
  }

  const summary: RunSummary = { locked: false, startedAt: nowIso, sources: [], eventsInserted: 0, weeklySent: null };
  try {
    const settings = await getSettings(db);
    const sources = await listEnabledSources(db);
    const roundEvents: EventInsert[] = [];
    // 本轮目录组内已报过的 added model_id(同轮两个目录先后出现只报第一次,DECISIONS §1)
    const roundCatalogAdds = new Set<string>();

    for (const src of sources) {
      // 单源异常不中断其余源(design §11)
      try {
        summary.sources.push(await pollSource(db, src, settings, nowIso, roundEvents, roundCatalogAdds));
      } catch (err) {
        console.error(`[poll] source=${src.name} 未预期异常:`, err);
        summary.sources.push({
          sourceId: src.id,
          sourceName: src.name,
          outcome: 'failed',
          fetched: false,
          error: `unexpected: ${err instanceof Error ? err.message : String(err)}`,
        });
      }
    }

    if (roundEvents.length > 0) {
      const ids = await insertEvents(db, roundEvents);
      roundEvents.forEach((e, i) => {
        const id = ids[i];
        if (id) e.row_id = id;
      });
    }
    summary.eventsInserted = roundEvents.length;

    if (opts.notifyHooks) {
      try {
        await opts.notifyHooks.dispatch(roundEvents, settings);
      } catch (err) {
        console.error('[notify] dispatch 失败(事件已落库,不重试):', err);
      }
      // 周报门控:周五 21:00 北京时间后首个触发且本周未发;发送成功才写回 weekly_last_sent
      const due = weeklyDue(now, settings['weekly_last_sent']);
      if (due) {
        try {
          await opts.notifyHooks.weekly();
          await saveSettings(db, { weekly_last_sent: due }, nowIso);
          summary.weeklySent = due;
        } catch (err) {
          console.error('[notify] 周报发送失败,本周门控未标记,下次触发重试:', err);
        }
      }
    }
  } finally {
    try {
      await releaseRunLock(db, holder);
    } catch (err) {
      console.error('[poll] run_lock 释放失败(等 10min 过期):', err);
    }
  }
  return summary;
}
