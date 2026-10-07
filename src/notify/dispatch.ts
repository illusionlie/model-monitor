/**
 * 通知分发(spec:product/notifications.md 通道矩阵):
 * - TG:tg_realtime ×(实时事件)/ tg_weekly ×(周报,见 weekly.ts);email 同理
 * - event_added_enabled / event_delisted_enabled 过滤 added/delisted;
 *   seed 确认 / 恢复通知走双通道「实时」开关;
 *   失败告警(source_fail)按 spec:product/notifications.md 只走 TG 实时通道,邮件不发
 * - suppressed=1 的一律不发(应在过滤阶段就丢弃)
 * - 单轮全部事件合并为一条消息(每源一节,render.ts)
 * - 发送成功的事件标记 events.notified=1
 */
import type { Env } from '../env';
import { parseBool, type SettingsMap } from '../db/settings';
import { markEventsNotified, type EventInsert, type EventKind } from '../db/events';
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

/** 本轮事件 → 按通道矩阵发送(合并为每通道一条消息) */
export async function dispatchRound(
  env: Env,
  events: EventInsert[],
  settings: SettingsMap,
  now: Date = new Date(),
): Promise<void> {
  if (!events.length) return;
  const sentIds = new Set<number>();

  const tgEvents = events.filter((e) => eligibleForTelegram(e, settings));
  if (parseBool(settings['tg_realtime']) && tgEvents.length > 0 && tgConfigured(settings)) {
    const html = renderRoundTg(tgEvents, now);
    const r = await notifyTelegram(settings['tg_bot_token']!.trim(), settings['tg_chat_id']!.trim(), html);
    if (r.sent > 0) for (const e of tgEvents) if (e.row_id) sentIds.add(e.row_id);
  }

  const emEvents = events.filter((e) => eligibleForEmail(e, settings));
  if (parseBool(settings['email_realtime']) && emEvents.length > 0 && emailConfigured(settings)) {
    const ok = await sendEmail(env, settings, renderRoundEmail(emEvents, now));
    if (ok) for (const e of emEvents) if (e.row_id) sentIds.add(e.row_id);
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
      result.telegram = r.sent > 0 ? 'ok' : 'error(发送失败,见日志)';
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
      result.email = (await sendEmail(env, settings, msg)) ? 'ok' : 'error(发送失败,见日志)';
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
