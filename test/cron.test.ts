import { describe, expect, it } from 'vitest';
import { FALLBACK_CRON, minutesToCron } from '../src/lib/cron';

describe('minutesToCron(spec:product/scheduling.md 映射规则)', () => {
  it('空/非法/≤0/非整数/非数值类型 → 兜底 */30', () => {
    const invalid: unknown[] = [
      '', '   ', 'abc', '12x', '1.5', 'NaN', 'Infinity', '-Infinity',
      '0', '-1', '-100', 0, -1, -100, 1.5, Number.NaN, Number.POSITIVE_INFINITY,
      null, undefined, true, false, {}, ['30'],
    ];
    for (const v of invalid) {
      expect(minutesToCron(v), `input=${JSON.stringify(v)}`).toBe(FALLBACK_CRON);
    }
  });

  it('1..59 → */N(含字符串与空白)', () => {
    expect(minutesToCron(1)).toBe('*/1 * * * *');
    expect(minutesToCron(5)).toBe('*/5 * * * *');
    expect(minutesToCron(30)).toBe('*/30 * * * *');
    expect(minutesToCron(59)).toBe('*/59 * * * *');
    expect(minutesToCron('45')).toBe('*/45 * * * *');
    expect(minutesToCron('  30  ')).toBe('*/30 * * * *');
  });

  it('60 → 每小时整点', () => {
    expect(minutesToCron(60)).toBe('0 * * * *');
    expect(minutesToCron('60')).toBe('0 * * * *');
  });

  it('>60 且为 60 的倍数 → 0 */H', () => {
    expect(minutesToCron(120)).toBe('0 */2 * * *');
    expect(minutesToCron(180)).toBe('0 */3 * * *');
    expect(minutesToCron(720)).toBe('0 */12 * * *');
    expect(minutesToCron('180')).toBe('0 */3 * * *');
  });

  it('>60 非倍数 → 向上取整到小时档', () => {
    expect(minutesToCron(61)).toBe('0 */2 * * *');
    expect(minutesToCron(90)).toBe('0 */2 * * *');
    expect(minutesToCron(100)).toBe('0 */2 * * *');
    expect(minutesToCron(121)).toBe('0 */3 * * *');
    expect(minutesToCron(721)).toBe('0 */13 * * *');
    expect(minutesToCron(1439)).toBe('0 0 * * *'); // 23h59m 向上取整到 24h 档 = 每天
  });

  it('≥1440 → 每天 0 点', () => {
    expect(minutesToCron(1440)).toBe('0 0 * * *');
    expect(minutesToCron(2000)).toBe('0 0 * * *');
    expect(minutesToCron(5000)).toBe('0 0 * * *');
    expect(minutesToCron('1440')).toBe('0 0 * * *');
  });
});
