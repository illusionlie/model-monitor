import { describe, expect, it } from 'vitest';
import { buildFetchHeaders } from '../src/poll/engine';

describe('buildFetchHeaders:合并顺序 accept < Bearer < 自定义头(design §2)', () => {
  it('无 key 无自定义头 → 仅内置 accept', () => {
    expect(buildFetchHeaders({ api_key: null, extra_headers: null })).toEqual({ accept: 'application/json' });
    expect(buildFetchHeaders({ api_key: '', extra_headers: '' })).toEqual({ accept: 'application/json' });
  });

  it('有 api_key → 派生 Bearer authorization', () => {
    expect(buildFetchHeaders({ api_key: 'sk-1', extra_headers: null })).toEqual({
      accept: 'application/json',
      authorization: 'Bearer sk-1',
    });
  });

  it('自定义头可覆盖内置 accept', () => {
    const h = buildFetchHeaders({ api_key: null, extra_headers: '{"accept":"text/plain"}' });
    expect(h).toEqual({ accept: 'text/plain' });
  });

  it('自定义头可覆盖 api_key 派生的 authorization(非 Bearer 鉴权主用例)', () => {
    const h = buildFetchHeaders({
      api_key: 'sk-1',
      extra_headers: '{"authorization":"Basic abc","x-api-key":"k"}',
    });
    expect(h.authorization).toBe('Basic abc');
    expect(h['x-api-key']).toBe('k');
    expect(h.accept).toBe('application/json');
  });

  it('自定义头与 key 共存互不干扰;坏存量静默忽略', () => {
    expect(buildFetchHeaders({ api_key: 'sk-1', extra_headers: '{"x-api-key":"k"}' })).toEqual({
      accept: 'application/json',
      authorization: 'Bearer sk-1',
      'x-api-key': 'k',
    });
    expect(buildFetchHeaders({ api_key: null, extra_headers: 'not-json' })).toEqual({
      accept: 'application/json',
    });
  });
});
