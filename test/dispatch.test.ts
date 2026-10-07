import { describe, expect, it } from 'vitest';
import type { EventInsert, EventKind } from '../src/db/events';
import { eligibleForEmail, eligibleForTelegram } from '../src/notify/dispatch';
import { DEGRADE_THRESHOLD, renderRoundEmail, renderRoundTg } from '../src/notify/render';

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
