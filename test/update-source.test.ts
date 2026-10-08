import { describe, expect, it } from 'vitest';
import { createChannelSource, deleteChannelSource, updateChannelSource } from '../src/db/sources';
import { D1Stub } from './helpers/d1';

const NOW = '2026-10-07T12:00:00.000Z';

describe('updateChannelSource:动态 SET 与绑定参数(内存 D1 stub)', () => {
  it('空 patch → 不执行任何语句', async () => {
    const db = new D1Stub();
    await updateChannelSource(db, 5, {}, NOW);
    expect(db.executed).toHaveLength(0);
  });

  it('单字段 name → 1 条 UPDATE,SET name + updated_at,绑定 [name, now, id]', async () => {
    const db = new D1Stub();
    await updateChannelSource(db, 5, { name: 'Zen' }, NOW);
    expect(db.executed).toHaveLength(1);
    expect(db.executed[0].sql).toBe('UPDATE sources SET name = ?, updated_at = ? WHERE id = ?');
    expect(db.executed[0].params).toEqual(['Zen', NOW, 5]);
  });

  it('四字段齐全 → SET 顺序 name, base_url, api_key, extra_headers, updated_at', async () => {
    const db = new D1Stub();
    await updateChannelSource(
      db,
      7,
      { name: 'A', base_url: 'https://a.example/v1/models', api_key: 'sk-1', extra_headers: '{"x-api-key":"k"}' },
      NOW,
    );
    expect(db.executed).toHaveLength(1);
    expect(db.executed[0].sql).toBe(
      'UPDATE sources SET name = ?, base_url = ?, api_key = ?, extra_headers = ?, updated_at = ? WHERE id = ?',
    );
    expect(db.executed[0].params).toEqual(['A', 'https://a.example/v1/models', 'sk-1', '{"x-api-key":"k"}', NOW, 7]);
  });

  it("'api_key' in patch 且值为 null → SET 含 api_key = ?,绑定 null(清空语义)", async () => {
    const db = new D1Stub();
    await updateChannelSource(db, 5, { api_key: null, extra_headers: null }, NOW);
    expect(db.executed[0].sql).toBe('UPDATE sources SET api_key = ?, extra_headers = ?, updated_at = ? WHERE id = ?');
    expect(db.executed[0].params).toEqual([null, null, NOW, 5]);
  });

  it("patch 不含 api_key/extra_headers → SET 不出现这两列(不修改语义)", async () => {
    const db = new D1Stub();
    await updateChannelSource(db, 5, { base_url: 'https://b.example/models' }, NOW);
    expect(db.executed[0].sql).not.toContain('api_key');
    expect(db.executed[0].sql).not.toContain('extra_headers');
    expect(db.executed[0].params).toEqual(['https://b.example/models', NOW, 5]);
  });
});

describe('deleteChannelSource:0004 去 FK 后显式删事件(行为与「事件记录一并删除」文案等价)', () => {
  it('batch 两条 DELETE:先 events 后 sources,绑定 [id]', async () => {
    const db = new D1Stub();
    await deleteChannelSource(db, 9);
    expect(db.executed).toHaveLength(2);
    expect(db.executed[0].sql).toBe('DELETE FROM events WHERE source_id = ?');
    expect(db.executed[0].params).toEqual([9]);
    expect(db.executed[1].sql).toBe(`DELETE FROM sources WHERE id = ? AND kind = 'channel'`);
    expect(db.executed[1].params).toEqual([9]);
  });
});

describe('createChannelSource:extra_headers 入参(内存 D1 stub)', () => {
  it('INSERT 含 extra_headers 列并绑定;缺省绑 null', async () => {
    const db = new D1Stub();
    await createChannelSource(
      db,
      { name: 'Zen', base_url: 'https://z.example/models', api_key: 'sk', extra_headers: '{"x-api-key":"k"}' },
      NOW,
    );
    expect(db.executed[0].sql).toContain('extra_headers');
    expect(db.executed[0].params).toEqual(['Zen', 'https://z.example/models', 'sk', '{"x-api-key":"k"}', NOW, NOW]);

    const db2 = new D1Stub();
    await createChannelSource(db2, { name: 'N', base_url: 'https://n.example/models' }, NOW);
    expect(db2.executed[0].params).toEqual(['N', 'https://n.example/models', null, null, NOW, NOW]);
  });
});
