import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../src/env';
import type { EventInsert, EventKind } from '../src/db/events';
import { dispatchRound, eligibleForEmail, eligibleForTelegram } from '../src/notify/dispatch';
import { DEGRADE_THRESHOLD, renderRoundEmail, renderRoundTg } from '../src/notify/render';
import { D1Stub } from './helpers/d1';

const NOW = new Date('2026-10-09T13:00:00.000Z'); // 北京周五 21:00 = UTC 13:00

const ev = (over: Partial<EventInsert>): EventInsert => ({
  source_id: 1,
  source_name: 'OpenRouter',
  kind: 'added',
  model_id: 'openai/gpt-x',
  dedup_group: 'catalog',
  suppressed: 0,
  notified: 0,
  payload: null,
  detected_at: NOW.toISOString(),
  ...over,
});

describe('通道矩阵:事件可见性(spec:product/notifications.md)', () => {
  it('默认开关(缺省 = 开):added/delisted 双通道均可见', () => {
    for (const kind of ['added', 'delisted'] as EventKind[]) {
      const e = ev({ kind });
      expect(eligibleForTelegram(e, {})).toBe(true);
      expect(eligibleForEmail(e, {})).toBe(true);
    }
  });

  it('event_added_enabled=false → added 双通道不可见;delisted 不受影响(开关独立)', () => {
    const s = { event_added_enabled: 'false' };
    expect(eligibleForTelegram(ev({ kind: 'added' }), s)).toBe(false);
    expect(eligibleForEmail(ev({ kind: 'added' }), s)).toBe(false);
    expect(eligibleForTelegram(ev({ kind: 'delisted' }), s)).toBe(true);
    expect(eligibleForEmail(ev({ kind: 'delisted' }), s)).toBe(true);
  });

  it('event_delisted_enabled=false → delisted 不可见;added 不受影响', () => {
    const s = { event_delisted_enabled: 'false' };
    expect(eligibleForTelegram(ev({ kind: 'delisted' }), s)).toBe(false);
    expect(eligibleForTelegram(ev({ kind: 'added' }), s)).toBe(true);
  });

  it('suppressed=1(目录组去重命中)→ 一律不可见(完全静默,spec:product/event-semantics.md)', () => {
    const e = ev({ suppressed: 1 });
    expect(eligibleForTelegram(e, {})).toBe(false);
    expect(eligibleForEmail(e, {})).toBe(false);
  });

  it('source_fail(连续失败告警)只走 TG 实时,邮件不发(spec:product/notifications.md)', () => {
    const e = ev({ kind: 'source_fail', model_id: null });
    expect(eligibleForTelegram(e, {})).toBe(true);
    expect(eligibleForEmail(e, {})).toBe(false);
  });

  it('seed / source_recovered 双通道可见(系统类,不受事件开关控制)', () => {
    const s = { event_added_enabled: 'false', event_delisted_enabled: 'false' };
    for (const kind of ['seed', 'source_recovered'] as EventKind[]) {
      const e = ev({ kind, model_id: null });
      expect(eligibleForTelegram(e, s)).toBe(true);
      expect(eligibleForEmail(e, s)).toBe(true);
    }
  });

  it('notify_fail(推送失败记录)→ 双通道均不可见(永不进任何通知通道,防「失败→告警→又失败」循环)', () => {
    const base = {
      source_id: 0,
      source_name: 'telegram',
      kind: 'notify_fail' as const,
      model_id: null,
      dedup_group: 'notify:telegram',
    };
    // 实际形态:suppressed=1 → 被 suppressed 过滤拦截
    expect(eligibleForTelegram(ev({ ...base, suppressed: 1 }), {})).toBe(false);
    expect(eligibleForEmail(ev({ ...base, suppressed: 1 }), {})).toBe(false);
    // 双保险:即便 suppressed=0(假设形态),baseEligible 也直接排除
    expect(eligibleForTelegram(ev({ ...base, suppressed: 0 }), {})).toBe(false);
    expect(eligibleForEmail(ev({ ...base, suppressed: 0 }), {})).toBe(false);
  });
});

describe('render:降级与文案语义(spec:product/event-semantics.md / scheduling.md)', () => {
  const mkAdded = (n: number): EventInsert[] =>
    Array.from({ length: n }, (_, i) => ev({ model_id: `openai/m-${i}` }));

  it(`单源 added ≤ ${DEGRADE_THRESHOLD} → 全量内联`, () => {
    const html = renderRoundTg(mkAdded(DEGRADE_THRESHOLD), NOW);
    expect(html).toContain(`openai/m-0`);
    expect(html).toContain(`openai/m-${DEGRADE_THRESHOLD - 1}`);
    expect(html).toContain('<blockquote expandable>');
  });

  it(`单源 added > ${DEGRADE_THRESHOLD} → 降级摘要 + 计数引导 /feed`, () => {
    const n = DEGRADE_THRESHOLD + 1;
    const html = renderRoundTg(mkAdded(n), NOW);
    expect(html).toContain(`…其余 ${n - 3} 个,完整列表见 /feed`);
    expect(html).not.toContain(`openai/m-3`); // 只内联前 3 个
    // 邮件同样降级
    const email = renderRoundEmail(mkAdded(n), NOW);
    expect(email.html).toContain(`@@ 仅列前 3 个,共 ${n} 个 · 完整列表见 /feed @@`);
    expect(email.subject).toBe(`📡 模型监视:+${n}`);
  });

  it('时间戳双标注:北京 + UTC 两行(spec:product/scheduling.md)', () => {
    const html = renderRoundTg(mkAdded(1), NOW);
    expect(html).toContain('北京时间 2026-10-09 21:00');
    expect(html).toContain('UTC时间 2026-10-09 13:00');
    const email = renderRoundEmail(mkAdded(1), NOW);
    expect(email.text).toContain('北京时间 2026-10-09 21:00');
    expect(email.text).toContain('UTC时间 2026-10-09 13:00');
  });

  it('模型 id / 源名 HTML 转义(TG parse_mode 安全)', () => {
    const html = renderRoundTg(
      [ev({ source_name: 'A<b>&Co', model_id: 'x/y<zoom>&me' })],
      NOW,
    );
    expect(html).toContain('x/y&lt;zoom&gt;&amp;me');
    expect(html).toContain('<b>A&lt;b&gt;&amp;Co</b>');
    expect(html).not.toContain('x/y<zoom>');
  });

  it('seed 事件 → 「已接入 · 存量 N」确认消息(静默 seed,spec:product/event-semantics.md)', () => {
    const html = renderRoundTg([ev({ kind: 'seed', model_id: null, payload: '{"count":464}' })], NOW);
    expect(html).toContain('已接入 · 存量 464 个模型');
  });

  it('失败告警文案带连续次数', () => {
    const html = renderRoundTg(
      [ev({ kind: 'source_fail', model_id: null, payload: '{"consecutive_failures":3,"error":"[http] 503"}' })],
      NOW,
    );
    expect(html).toContain('连续 3 次探测失败');
    expect(html).toContain('[http] 503');
  });
});

describe('dispatchRound:发送失败落库与 notified 语义(任务 10-08-notify-fail-event,stub db + mock fetch)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const notifyFailInserts = (db: D1Stub) => db.executed.filter((s) => s.sql.startsWith('INSERT INTO events'));
  const hasMarkNotified = (db: D1Stub) => db.executed.some((s) => s.sql.startsWith('UPDATE events SET notified'));

  it('TG 已启用且配置完整、全部段失败 → INSERT 一条 notify_fail(suppressed=1);本轮事件不标记 notified', async () => {
    const db = new D1Stub();
    const fetchMock = vi.fn().mockRejectedValue(new TypeError('fetch failed'));
    vi.stubGlobal('fetch', fetchMock);
    await dispatchRound(
      { DB: db } as Env,
      [ev({ row_id: 11 })],
      { tg_realtime: 'true', tg_bot_token: 't', tg_chat_id: 'c' },
      NOW,
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const ins = notifyFailInserts(db);
    expect(ins).toHaveLength(1);
    // 绑定顺序:(source_id, source_name, kind, model_id, dedup_group, suppressed, notified, payload, detected_at)
    expect(ins[0].params.slice(0, 6)).toEqual([0, 'telegram', 'notify_fail', null, 'notify:telegram', 1]);
    expect(ins[0].params[6]).toBe(0);
    expect(ins[0].params[8]).toBe(NOW.toISOString());
    expect(JSON.parse(ins[0].params[7] as string)).toMatchObject({
      channel: 'telegram',
      sent: 0,
      total: 1,
      error: 'fetch failed',
    });
    expect(hasMarkNotified(db)).toBe(false);
  });

  it('TG 部分段失败(0 < sent < total)→ payload 含 {sent,total};不标记 notified(语义修正)', async () => {
    const longId = 'a'.repeat(3000);
    const events = [ev({ model_id: longId, row_id: 21 }), ev({ model_id: `b${'x'.repeat(3000)}`, row_id: 22 })];
    const db = new D1Stub();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response('{"ok":true}', { status: 200 }))
      .mockResolvedValue(new Response('{"ok":false,"description":"Too Many Requests"}', { status: 429 }));
    vi.stubGlobal('fetch', fetchMock);
    await dispatchRound(
      { DB: db } as Env,
      events,
      { tg_realtime: 'true', tg_bot_token: 't', tg_chat_id: 'c' },
      NOW,
    );
    expect(fetchMock).toHaveBeenCalledTimes(2); // 两个超长模型行 → 恰 2 段
    const ins = notifyFailInserts(db);
    expect(ins).toHaveLength(1);
    expect(JSON.parse(ins[0].params[7] as string)).toMatchObject({
      channel: 'telegram',
      sent: 1,
      total: 2,
      error: 'Telegram sendMessage HTTP 429',
    });
    expect(hasMarkNotified(db)).toBe(false); // sent<total → 不谎报已通知
  });

  it('双通道同轮都失败 → 各落一条(telegram + email);email 失败摘要随 payload', async () => {
    const db = new D1Stub();
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('fetch failed')));
    await dispatchRound(
      { DB: db } as Env, // 无 SEND_EMAIL binding → email 走「未部署」失败分支
      [ev({ row_id: 31 })],
      {
        tg_realtime: 'true',
        tg_bot_token: 't',
        tg_chat_id: 'c',
        email_realtime: 'true',
        email_from: 'a@b.c',
        email_to: 'd@e.f',
      },
      NOW,
    );
    const ins = notifyFailInserts(db);
    expect(ins).toHaveLength(2);
    const groups = ins.map((s) => s.params[4]);
    expect(groups).toEqual(['notify:telegram', 'notify:email']);
    expect(JSON.parse(ins[0].params[7] as string)).toMatchObject({ channel: 'telegram' });
    const emailPayload = JSON.parse(ins[1].params[7] as string);
    expect(emailPayload.channel).toBe('email');
    expect(emailPayload.error).toContain('SEND_EMAIL binding 未部署');
    expect(hasMarkNotified(db)).toBe(false);
  });

  it('通道未启用或未配置 = 未尝试:零 INSERT、零 fetch(不是失败,不落事件)', async () => {
    // 1) 开关全关
    const db1 = new D1Stub();
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await dispatchRound({ DB: db1 } as Env, [ev({ row_id: 41 })], {}, NOW);
    // 2) tg_realtime 开但 token 缺失(未配置)
    const db2 = new D1Stub();
    await dispatchRound({ DB: db2 } as Env, [ev({ row_id: 42 })], { tg_realtime: 'true', tg_chat_id: 'c' }, NOW);
    // 3) email_realtime 开但 from/to 缺失(未配置)
    const db3 = new D1Stub();
    await dispatchRound({ DB: db3 } as Env, [ev({ row_id: 43 })], { email_realtime: 'true' }, NOW);
    for (const db of [db1, db2, db3]) {
      expect(notifyFailInserts(db)).toHaveLength(0);
      expect(hasMarkNotified(db)).toBe(false);
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('双通道全部成功 → 零失败事件;本轮事件标记 notified=1(正路径)', async () => {
    const db = new D1Stub();
    const fetchMock = vi.fn().mockResolvedValue(new Response('{"ok":true}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const sendEmail = vi.fn().mockResolvedValue(undefined);
    await dispatchRound(
      { DB: db, SEND_EMAIL: { send: sendEmail } } as Env,
      [ev({ row_id: 51 }), ev({ row_id: 52 })],
      {
        tg_realtime: 'true',
        tg_bot_token: 't',
        tg_chat_id: 'c',
        email_realtime: 'true',
        email_from: 'a@b.c',
        email_to: 'd@e.f',
      },
      NOW,
    );
    expect(fetchMock).toHaveBeenCalledTimes(1); // 短消息单段
    expect(sendEmail).toHaveBeenCalledTimes(1);
    expect(notifyFailInserts(db)).toHaveLength(0);
    expect(hasMarkNotified(db)).toBe(true);
    const upd = db.executed.find((s) => s.sql.startsWith('UPDATE events SET notified'));
    expect(upd?.params.sort((a, b) => Number(a) - Number(b))).toEqual([51, 52]);
  });
});
