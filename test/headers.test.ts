import { describe, expect, it } from 'vitest';
import { parseStoredHeaders, sanitizeHeaderMap } from '../src/lib/headers';

describe('parseStoredHeaders:存量容错读(绝不抛)', () => {
  it('null / undefined / 空串 / 坏 JSON / 非平面对象 → {}', () => {
    expect(parseStoredHeaders(null)).toEqual({});
    expect(parseStoredHeaders(undefined)).toEqual({});
    expect(parseStoredHeaders('')).toEqual({});
    expect(parseStoredHeaders('not-json{')).toEqual({});
    expect(parseStoredHeaders('[]')).toEqual({});
    expect(parseStoredHeaders('42')).toEqual({});
    expect(parseStoredHeaders('"str"')).toEqual({});
  });

  it('非法项逐个静默丢弃,合法项保留(值 trim)', () => {
    const stored = JSON.stringify({
      'x-api-key': ' sk-1 ',
      'bad:name': 'v', // 键含冒号 → 滤
      'with\nl': 'v', // 键含 LF → 滤
      'ctl\u0000': 'v', // 键含 C0 → 滤
      not_string: 123, // 值非字符串 → 滤
      crlf: 'a\r\nb', // 值内部 CRLF → 滤
      '': 'empty-name', // 键 trim 后空 → 滤
    });
    expect(parseStoredHeaders(stored)).toEqual({ 'x-api-key': 'sk-1' });
  });

  it('大小写重复(仅大小写差异)只留首个', () => {
    expect(parseStoredHeaders(JSON.stringify({ 'X-Key': '1', 'x-key': '2' }))).toEqual({ 'X-Key': '1' });
  });

  it('正常对象完整读出', () => {
    expect(parseStoredHeaders(JSON.stringify({ 'x-api-key': 'sk-1', accept: 'text/plain' }))).toEqual({
      'x-api-key': 'sk-1',
      accept: 'text/plain',
    });
  });

  it('超过 16 个有效项:超出部分丢弃(只可能来自手改库)', () => {
    const entries: Record<string, string> = {};
    for (let i = 0; i < 20; i++) entries[`x-h-${i}`] = String(i);
    const out = parseStoredHeaders(JSON.stringify(entries));
    expect(Object.keys(out)).toHaveLength(16);
  });
});

describe('sanitizeHeaderMap:写路径校验(非法 → null)', () => {
  it('非 plain object(数组/null/undefined/字符串/数字)→ null', () => {
    expect(sanitizeHeaderMap([])).toBeNull();
    expect(sanitizeHeaderMap(null)).toBeNull();
    expect(sanitizeHeaderMap(undefined)).toBeNull();
    expect(sanitizeHeaderMap('x')).toBeNull();
    expect(sanitizeHeaderMap(42)).toBeNull();
  });

  it('键含冒号 / CR / LF / C0 控制字符 / trim 后为空 → null;键 trim', () => {
    expect(sanitizeHeaderMap({ 'bad:name': 'v' })).toBeNull();
    expect(sanitizeHeaderMap({ 'a\nb': 'v' })).toBeNull();
    expect(sanitizeHeaderMap({ 'a\rb': 'v' })).toBeNull();
    expect(sanitizeHeaderMap({ 'a\u0000b': 'v' })).toBeNull();
    expect(sanitizeHeaderMap({ '': 'v' })).toBeNull();
    expect(sanitizeHeaderMap({ '   ': 'v' })).toBeNull();
    expect(sanitizeHeaderMap({ '  x-api-key  ': 'v' })).toEqual({ 'x-api-key': 'v' });
  });

  it('值非字符串或内部含 CR/LF → null;值 trim;首尾 CR/LF 被 trim 掉 → 合法(注入安全由最终值保证)', () => {
    expect(sanitizeHeaderMap({ a: 1 })).toBeNull();
    expect(sanitizeHeaderMap({ a: null })).toBeNull();
    expect(sanitizeHeaderMap({ a: 'x\ry' })).toBeNull();
    expect(sanitizeHeaderMap({ a: 'x\ny' })).toBeNull();
    expect(sanitizeHeaderMap({ a: '  v  ' })).toEqual({ a: 'v' });
    expect(sanitizeHeaderMap({ a: 'v\r\n' })).toEqual({ a: 'v' });
  });

  it('数量超 16 → null;恰 16 个 → 合法', () => {
    const ok: Record<string, string> = {};
    for (let i = 0; i < 16; i++) ok[`x-h-${i}`] = String(i);
    expect(sanitizeHeaderMap(ok)).toEqual(ok);
    expect(sanitizeHeaderMap({ ...ok, extra: 'x' })).toBeNull();
  });

  it('键超 128 / 值超 1024 → null;恰在边界 → 合法', () => {
    expect(sanitizeHeaderMap({ ['k'.repeat(129)]: 'v' })).toBeNull();
    expect(sanitizeHeaderMap({ k: 'v'.repeat(1025) })).toBeNull();
    const boundary = { ['k'.repeat(128)]: 'v'.repeat(1024) };
    expect(sanitizeHeaderMap(boundary)).toEqual(boundary);
  });

  it('大小写重复键 → null(fetch 头大小写不敏感,避免歧义)', () => {
    expect(sanitizeHeaderMap({ 'X-Key': '1', 'x-key': '2' })).toBeNull();
    expect(sanitizeHeaderMap({ Accept: '1', accept: '2' })).toBeNull();
  });

  it('空对象合法(= 清空)→ {}', () => {
    expect(sanitizeHeaderMap({})).toEqual({});
  });
});
