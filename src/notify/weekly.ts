/**
 * 周报(design §8):
 * - 门控:weeklyDue(now, weekly_last_sent)(engine 在 runOnce 内已做过一次,这里幂等复查)
 * - 聚合本周(周一 00:00 北京 → now)事件:added/delisted 计数 + 明细(渲染层降级)、
 *   每源当前模型数、失败摘要;suppressed=1 的事件完全静默(不计数不出明细)
 * - 走各通道 *_weekly 开关,与实时开关独立;发完由 engine 写回 weekly_last_sent
 */
import type { Env } from '../env';
import { beijingWeekStart, weeklyDue } from '../lib/time';
import { getSettings, parseBool } from '../db/settings';
import { countModelsBySource } from '../db/models';
import { eventsBetween, type EventRow } from '../db/events';
import { listAllSources } from '../db/sources';
import { notifyTelegram, tgConfigured } from './telegram';
import { emailConfigured, sendEmail } from './email';
import { recordNotifyFail } from './dispatch';
import { groupBySource, renderWeeklyEmail, renderWeeklyTg, type WeeklyData } from './render';

/** 周事件(剔除 suppressed)→ WeeklyData(suppressed 语义:完全静默,周报同样不可见) */
export function aggregateWeekly(
  weekId: string,
  fromIso: string,
  toIso: string,
  events: readonly EventRow[],
  modelCounts: ReadonlyMap<number, number>,
  sourceNames: ReadonlyMap<number, string>,
): WeeklyData {
  const visible = events.filter((e) => e.suppressed !== 1);
  const data: WeeklyData = {
    weekId,
    fromIso,
    toIso,
    sections: groupBySource(visible),
    addedCount: visible.filter((e) => e.kind === 'added').length,
    delistedCount: visible.filter((e) => e.kind === 'delisted').length,
    failCount: visible.filter((e) => e.kind === 'source_fail').length,
    seedCount: visible.filter((e) => e.kind === 'seed').length,
    recoveredCount: visible.filter((e) => e.kind === 'source_recovered').length,
    modelCounts,
    sourceNames,
  };
  return data;
}

/** 入口(engine hooks.weekly / 立即运行共用)。未到期直接返回;发送异常上抛→engine 不标记,下次重试。 */
export async function sendWeeklyReport(env: Env, now: Date = new Date()): Promise<void> {
  const settings = await getSettings(env.DB);
  const due = weeklyDue(now, settings['weekly_last_sent']);
  if (!due) return;

  const fromIso = beijingWeekStart(now).toISOString();
  const toIso = now.toISOString();
  const [events, modelCounts, sources] = await Promise.all([
    eventsBetween(env.DB, fromIso, toIso, 1000),
    countModelsBySource(env.DB),
    listAllSources(env.DB),
  ]);
  const sourceNames = new Map(sources.map((s) => [s.id, s.name]));
  const data = aggregateWeekly(due, fromIso, toIso, events, modelCounts, sourceNames);
  console.log(
    `[notify] 周报 ${due}:added=${data.addedCount} delisted=${data.delistedCount} fail=${data.failCount} seed=${data.seedCount}`,
  );

  let anyChannelOn = false;
  if (parseBool(settings['tg_weekly']) && tgConfigured(settings)) {
    anyChannelOn = true;
    const r = await notifyTelegram(
      settings['tg_bot_token']!.trim(),
      settings['tg_chat_id']!.trim(),
      renderWeeklyTg(data, now),
    );
    // 发送失败(全部/部分段)→ 落 notify_fail 可见事件;门控照常标记(本函数不抛错),失败仅留记录、内容不自动重发
    if (r.sent < r.total) {
      console.error(`[notify] 周报 TG 发送失败(${r.sent}/${r.total} 段)`);
      await recordNotifyFail(env.DB, 'telegram', { sent: r.sent, total: r.total, error: r.errors[0] }, now.toISOString());
    }
  }
  if (parseBool(settings['email_weekly']) && emailConfigured(settings)) {
    anyChannelOn = true;
    const r = await sendEmail(env, settings, renderWeeklyEmail(data, now));
    if (!r.ok) {
      console.error('[notify] 周报邮件发送失败');
      await recordNotifyFail(env.DB, 'email', { error: r.error }, now.toISOString());
    }
  }
  if (!anyChannelOn) console.log('[notify] 周报:无已启用的周报通道,本周标记为已处理');
}
