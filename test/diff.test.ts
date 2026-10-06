import { describe, expect, it } from 'vitest';
import { diffModels, type PrevModel } from '../src/poll/diff';

const T0 = '2026-10-01T00:00:00.000Z';

const mk = (id: string, missing = 0): PrevModel => ({
  model_id: id,
  provider: null,
  missing,
  snapshot: null,
  first_seen: T0,
  last_state_change: T0,
});

const prevOf = (...ms: PrevModel[]): ReadonlyMap<string, PrevModel> => new Map(ms.map((m) => [m.model_id, m]));
const liveOf = (...ids: string[]): ReadonlySet<string> => new Set(ids);

describe('diff 状态机(design §5 五类迁移)', () => {
  it('① live 有、DB 无 → added(INSERT + added 事件)', () => {
    const d = diffModels(prevOf(mk('a'), mk('b')), liveOf('a', 'b', 'c'));
    expect(d.added).toEqual(['c']);
    expect(d.delisted).toEqual([]);
    expect(d.missingFirst).toEqual([]);
    expect(d.recovered).toEqual([]);
  });

  it('② live 无、DB 有、missing=0 → 仅 missingFirst(静默标记,不产生事件)', () => {
    const d = diffModels(prevOf(mk('a'), mk('b')), liveOf('a'));
    expect(d.missingFirst).toEqual(['b']);
    expect(d.delisted).toEqual([]);
    expect(d.added).toEqual([]);
    expect(d.recovered).toEqual([]);
  });

  it('③ live 无、missing=1 → delisted(判死删行,连续 2 次缺席)', () => {
    const d = diffModels(prevOf(mk('a', 1), mk('b')), liveOf('b'));
    expect(d.delisted).toEqual(['a']);
    expect(d.missingFirst).toEqual([]); // b 在架,不受影响
    expect(d.added).toEqual([]);
    expect(d.recovered).toEqual([]);
  });

  it('④ live 有、missing=1 → recovered 复位,绝不产生 added(从未判死)', () => {
    const d = diffModels(prevOf(mk('a', 1), mk('b')), liveOf('a', 'b'));
    expect(d.recovered).toEqual(['a']);
    expect(d.added).toEqual([]); // 关键:不报 added
    expect(d.missingFirst).toEqual([]);
    expect(d.delisted).toEqual([]);
  });

  it('⑤ live 有、missing=0 → 不写回(严禁刷 last_seen)', () => {
    const d = diffModels(prevOf(mk('a'), mk('b')), liveOf('a', 'b'));
    expect(d.added).toEqual([]);
    expect(d.delisted).toEqual([]);
    expect(d.missingFirst).toEqual([]);
    expect(d.recovered).toEqual([]);
  });

  it('混合场景:五类迁移同轮并存', () => {
    // prev: a 在架 / b 首缺过 / c 在架 / d 首缺过;live: a, b, x
    const d = diffModels(
      prevOf(mk('a'), mk('b', 1), mk('c'), mk('d', 1)),
      liveOf('a', 'b', 'x'),
    );
    expect(d.added).toEqual(['x']); // x 新增
    expect(d.recovered).toEqual(['b']); // b 重现复位
    expect(d.missingFirst).toEqual(['c']); // c 首次缺席(静默)
    expect(d.delisted).toEqual(['d']); // d 连续第 2 次缺席 → 判死
  });

  it('空 live:在架的全部 missingFirst,首缺的全部 delisted', () => {
    const d = diffModels(prevOf(mk('a'), mk('b', 1)), liveOf());
    expect(d.missingFirst).toEqual(['a']);
    expect(d.delisted).toEqual(['b']);
    expect(d.added).toEqual([]);
  });

  it('空 prev(等价新源):全部 added', () => {
    const d = diffModels(prevOf(), liveOf('a', 'b'));
    expect(d.added).toEqual(['a', 'b']);
  });
});
