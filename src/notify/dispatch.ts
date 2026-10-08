/**
 * 通知分发(spec:product/notifications.md 通道矩阵):
 * - TG:tg_realtime ×(实时事件)/ tg_weekly ×(周报,见 weekly.ts);email 同理
 * - event_added_enabled / event_delisted_enabled 过滤 added/delisted;
 *   seed 确认 / 恢复通知走双通道「实时」开关;
 *   失败告警(source_fail)按 spec:product/notifications.md 只走 TG 实时通道,邮件不发
 * - suppressed=1 的一律不发(应在过滤阶段就丢弃)
 * - 单轮全部事件合并为一条消息(每源一节,render.ts)
 * - 发送成功的事件标记 events.notified=1(TG 需全部段送达;部分失败不标,PRD 需求 3)
 * - 通道已启用且配置完整但发送失败(全部/部分段)→ 落一条 notify_fail 系统事件
 *   (suppressed=1:后台最近事件与 /feed 可见,永不进任何通知通道)
 */
import type { Env } from '../env';
import { parseBool, type SettingsMap } from '../db/settings';
import { insertEvents, markEventsNotified, type EventInsert, type EventKind } from '../db/events';
import type { NotifyHooks } from '../poll/engine';
import { formatDualBeijingUtc } from '../lib/time';
import { renderRoundEmail, renderRoundTg, type EmailMessage } from './render';
import { notifyTelegram, tgConfigured } from './telegram';
import { emailConfigured, sendEmail } from './email';
import { sendWeeklyReport } from './weekly';

/** 事件 → 某通道是否可见(suppressed 过滤 + 事件开关;排除渠道差异) */
function baseEligible(kind: EventKind, settings: SettingsMap): boolean {
  switch (kind) {
    case 'added':
      return parseBool(settings['event_added_enabled'], true);
    case 'delisted':
      return parseBool(settings['event_delisted_enabled'], true);
    case 'seed':
    case 'source_recovered':
    case 'source_fail':
      return true; // 系统类消息不受事件开关控制,受「实时」总开关控制
    case 'notify_fail':
      return false; // 失败事件自身永不进任何通知通道(suppressed=1 之外的双保险,防「失败→告警→又失败」循环)
  }
}

/** TG 实时通道可见事件 */
export function eligibleForTelegram(e: EventInsert, settings: SettingsMap): boolean {
  return e.suppressed !== 1 && baseEligible(e.kind, settings);
}

/** 邮件实时通道可见事件(失败告警只走 TG,spec:product/notifications.md) */
export function eligibleForEmail(e: EventInsert, settings: SettingsMap): boolean {
  if (e.kind === 'source_fail') return false;
  return e.suppressed !== 1 && baseEligible(e.kind, settings);
}

/**
 * 通知通道发送失败 → 系统级失败事件(design「事件形态」):
 * source_id=0(系统级,migration 0004 起 events 无 FK)、suppressed=1(入库可见、永不进任何通知通道)、
 * dedup_group='notify:{channel}'(独立于 catalog / channel:*,天然不参与目录去重查询)。
 * 插入失败只记日志不阻塞主流程(与 markEventsNotified 同策略)。
 */
export async function recordNotifyFail(
  db: D1Database,
  channel: 'telegram' | 'email',
  detail: { sent?: number; total?: number; error?: string },
  nowIso: string,
): Promise<void> {
  const payload: Record<string, unknown> = { channel };
  if (detail.sent !== undefined) payload.sent = detail.sent;
  if (detail.total !== undefined) payload.total = detail.total;
  if (detail.error) payload.error = detail.error.length > 200 ? `${detail.error.slice(0, 197)}...` : detail.error;
  try {
    await insertEvents(db, [
      {
        source_id: 0,
        source_name: channel,
        kind: 'notify_fail',
        model_id: null,
        dedup_group: `notify:${channel}`,
        suppressed: 1,
        notified: 0,
        payload: JSON.stringify(payload),
        detected_at: nowIso,
      },
    ]);
  } catch (err) {
    console.error('[notify] notify_fail 事件落库失败(可忽略):', err);
  }
}

/** 本轮事件 → 按通道矩阵发送(合并为每通道一条消息) */
export async function dispatchRound(
  env: Env,
  events: EventInsert[],
  settings: SettingsMap,
  now: Date = new Date(),
): Promise<void> {
  if (!events.length) return;
  const nowIso = now.toISOString();
  const sentIds = new Set<number>();

  const tgEvents = events.filter((e) => eligibleForTelegram(e, settings));
  if (parseBool(settings['tg_realtime']) && tgEvents.length > 0 && tgConfigured(settings)) {
    const html = renderRoundTg(tgEvents, now);
    const r = await notifyTelegram(settings['tg_bot_token']!.trim(), settings['tg_chat_id']!.trim(), html);
    if (r.sent < r.total) {
      await recordNotifyFail(env.DB, 'telegram', { sent: r.sent, total: r.total, error: r.errors[0] }, nowIso);
    }
    // 仅全部段送达才标记已通知:部分失败时内容实际丢失,不得谎报(PRD 需求 3)
    if (r.sent === r.total) for (const e of tgEvents) if (e.row_id) sentIds.add(e.row_id);
  }

  const emEvents = events.filter((e) => eligibleForEmail(e, settings));
  if (parseBool(settings['email_realtime']) && emEvents.length > 0 && emailConfigured(settings)) {
    const r = await sendEmail(env, settings, renderRoundEmail(emEvents, now));
    if (!r.ok) await recordNotifyFail(env.DB, 'email', { error: r.error }, nowIso);
    if (r.ok) for (const e of emEvents) if (e.row_id) sentIds.add(e.row_id);
  }

  if (sentIds.size > 0) {
    try {
      await markEventsNotified(env.DB, [...sentIds]);
    } catch (err) {
      console.error('[notify] 标记 notified 失败(可忽略):', err);
    }
  }
}

/** 后台「发送测试通知」:向已启用(实时或周报任一开)且配置完整的通道发测试消息 */
export async function sendTestNotification(
  env: Env,
  settings: SettingsMap,
): Promise<{ telegram: string; email: string }> {
  const result = { telegram: 'skipped', email: 'skipped' };
  const now = new Date();
  const ts = formatDualBeijingUtc(now);

  const tgOn = parseBool(settings['tg_realtime']) || parseBool(settings['tg_weekly']);
  if (tgConfigured(settings)) {
    if (!tgOn) {
      result.telegram = 'skipped(实时与周报开关均未开启)';
    } else {
      const html = `🧪 <b>模型监视 · 测试通知</b>\n通道连通正常。\n${ts}`;
      const r = await notifyTelegram(settings['tg_bot_token']!.trim(), settings['tg_chat_id']!.trim(), html);
      result.telegram =
        r.sent === r.total
          ? 'ok'
          : `error(发送失败 ${r.sent}/${r.total} 段:${r.errors[0] ?? '未知错误'})`;
    }
  }

  const emOn = parseBool(settings['email_realtime']) || parseBool(settings['email_weekly']);
  if (emailConfigured(settings)) {
    if (!emOn) {
      result.email = 'skipped(实时与周报开关均未开启)';
    } else {
      const msg: EmailMessage = {
        subject: '🧪 模型监视 · 测试通知',
        html: `<!doctype html><html><body style="font-family:system-ui,sans-serif"><p><strong>模型监视 · 测试通知</strong></p><p>通道连通正常。</p><p style="color:#777">${ts}</p></body></html>`,
        text: `模型监视 · 测试通知\n通道连通正常。\n${ts}`,
      };
      const r = await sendEmail(env, settings, msg);
      result.email = r.ok ? 'ok' : `error(发送失败:${r.error ?? '未知错误'})`;
    }
  }
  return result;
}

/** 注入 engine 的真实通知钩子(scheduled 与「立即运行」共用) */
export function makeNotifyHooks(env: Env): NotifyHooks {
  return {
    dispatch: (events, settings) => dispatchRound(env, events, settings),
    weekly: () => sendWeeklyReport(env),
  };
}
