import { describe, expect, it } from 'vitest';
import type { EventInsert } from '../src/db/events';
import { applyCatalogDedup } from '../src/poll/engine';

const NOW = '2026-10-06T12:00:00.000Z';

const ev = (over: Partial<EventInsert>): EventInsert => ({
  source_id: 1,
  source_name: 'OpenRouter',
  kind: 'added',
  model_id: 'openai/gpt-x',
  dedup_group: 'catalog',
  suppressed: 0,
  notified: 0,
  payload: null,
  detected_at: NOW,
  ...over,
});

describe('全局目录组去重(spec:product/event-semantics.md)', () => {
  it('catalog 组内 added 且历史已报过同 model_id → suppressed=1(入库但完全静默)', () => {
    const events = [ev({ model_id: 'openai/gpt-x' }), ev({ model_id: 'anthropic/claude-y' })];
    const n = applyCatalogDedup(events, new Set(['openai/gpt-x']));
    expect(n).toBe(1);
    expect(events[0].suppressed).toBe(1); // 已报过 → 压制
    expect(events[1].suppressed).toBe(0); // 首次 → 正常
  });

  it('历史未报过 → 不压制', () => {
    const events = [ev({ model_id: 'google/gemini-z' })];
    expect(applyCatalogDedup(events, new Set())).toBe(0);
    expect(events[0].suppressed).toBe(0);
  });

  it('delisted 事件不参与去重(即使历史报过同 model_id 的 added)', () => {
    const events = [ev({ kind: 'delisted', model_id: 'openai/gpt-x' })];
    applyCatalogDedup(events, new Set(['openai/gpt-x']));
    expect(events[0].suppressed).toBe(0);
  });

  it('渠道源(dedup_group=channel:{source_id})永不压制——即使目录组已报过同模型', () => {
    const events = [
      ev({ source_id: 3, source_name: 'Zen', dedup_group: 'channel:3', model_id: 'openai/gpt-x' }),
      ev({ source_id: 4, source_name: 'Cline', dedup_group: 'channel:4', model_id: 'openai/gpt-x' }),
    ];
    expect(applyCatalogDedup(events, new Set(['openai/gpt-x']))).toBe(0);
    expect(events.every((e) => e.suppressed === 0)).toBe(true);
  });

  it('seed / source_fail / source_recovered 事件不受影响', () => {
    const events = [
      ev({ kind: 'seed', model_id: null, payload: '{"count":464}' }),
      ev({ kind: 'source_fail', model_id: null, payload: '{"consecutive_failures":3}' }),
      ev({ kind: 'source_recovered', model_id: null }),
    ];
    expect(applyCatalogDedup(events, new Set(['openai/gpt-x']))).toBe(0);
    expect(events.every((e) => e.suppressed === 0)).toBe(true);
  });
});
