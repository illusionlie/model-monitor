import { describe, expect, it } from 'vitest';
import { beijingWeekStart, beijingWeekId, weeklyDue } from '../src/lib/time';

/**
 * 2026-10-09 是本周(2026-W41,周一起 10-05)的周五。
 * 北京 21:00 = UTC 13:00。门控语义(spec:product/scheduling.md):每周五 21:00(Asia/Shanghai)后首个触发且本周未发。
 */

describe('周报门控 weeklyDue(design §8 / spec:product/scheduling.md)', () => {
  it('周五 20:59(北京)不触发', () => {
    expect(weeklyDue(new Date('2026-10-09T12:59:00Z'), undefined)).toBeNull();
    expect(weeklyDue(new Date('2026-10-09T12:59:59Z'), null)).toBeNull();
  });

  it('周五 21:00(北京)= UTC 13:00 边界,恰好触发', () => {
    const due = weeklyDue(new Date('2026-10-09T13:00:00Z'), undefined);
    expect(due).toBe('2026-W41');
  });

  it('周六补发(本周尚未发过)', () => {
    expect(weeklyDue(new Date('2026-10-10T02:00:00Z'), undefined)).toBe('2026-W41'); // 北京周六 10:00
    expect(weeklyDue(new Date('2026-10-11T15:30:00Z'), '')).toBe('2026-W41'); // 北京周日 23:30
  });

  it('本周已发过 → 不重发(跨周六/周日)', () => {
    expect(weeklyDue(new Date('2026-10-10T02:00:00Z'), '2026-W41')).toBeNull();
    expect(weeklyDue(new Date('2026-10-09T15:00:00Z'), '2026-W41')).toBeNull();
  });

  it('周五 21:00 前即使 lastSent 是别的周也不触发(只在门槛后发)', () => {
    expect(weeklyDue(new Date('2026-10-09T12:00:00Z'), '2026-W40')).toBeNull();
  });

  it('下周五 21:00 后进入新一周,旧标记不再压制', () => {
    expect(weeklyDue(new Date('2026-10-16T13:00:00Z'), '2026-W41')).toBe('2026-W42');
  });

  it('周内(周二/周四)不触发', () => {
    expect(weeklyDue(new Date('2026-10-06T12:00:00Z'), undefined)).toBeNull(); // 本周二
    expect(weeklyDue(new Date('2026-10-08T16:00:00Z'), undefined)).toBeNull(); // 本周四 北京周五 00:00
  });
});

describe('周标识与统计窗口(lib/time)', () => {
  it('beijingWeekId:ISO 周一为一周开始(北京 = UTC+8)', () => {
    expect(beijingWeekId(new Date('2026-10-05T00:30:00Z'))).toBe('2026-W41'); // 北京周一 08:30
    expect(beijingWeekId(new Date('2026-10-04T10:00:00Z'))).toBe('2026-W40'); // 北京周日 18:00,仍属上周
    expect(beijingWeekId(new Date('2026-10-04T20:00:00Z'))).toBe('2026-W41'); // 北京周一 04:00,跨入新周
  });

  it('beijingWeekStart:本周周一 00:00 北京 → 前一日 16:00 UTC', () => {
    const start = beijingWeekStart(new Date('2026-10-09T13:00:00Z'));
    expect(start.toISOString()).toBe('2026-10-04T16:00:00.000Z'); // 周一 2026-10-05 00:00 北京
    // 窗口起点必须早于门控时刻
    expect(start.getTime()).toBeLessThan(new Date('2026-10-09T13:00:00Z').getTime());
  });
});
