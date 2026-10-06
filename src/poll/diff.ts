/**
 * diff 状态机(design §5,纯函数——免费档逻辑全部下沉到这里便于单测):
 *
 * | live | DB(prev)          | 输出                                   | 事件        |
 * |------|-------------------|----------------------------------------|-------------|
 * | 有   | 无                | added(INSERT missing=0)               | added       |
 * | 无   | 有, missing=0    | missingFirst(UPDATE missing=1)        | 无(静默)   |
 * | 无   | 有, missing=1    | delisted(DELETE,判死=连续 2 次缺席)  | delisted    |
 * | 有   | 有, missing=1    | recovered(UPDATE missing=0)           | 无(不报 added)|
 * | 有   | 有, missing=0    | 不写(不刷 last_seen,DECISIONS §4)   | 无          |
 */
export interface PrevModel {
  model_id: string;
  provider: string | null;
  missing: number;
  snapshot: string | null;
  first_seen: string;
  last_state_change: string;
}

export interface DiffOutput {
  added: string[];
  delisted: string[];
  missingFirst: string[];
  recovered: string[];
}

export function diffModels(prev: ReadonlyMap<string, PrevModel>, live: ReadonlySet<string>): DiffOutput {
  const added: string[] = [];
  const delisted: string[] = [];
  const missingFirst: string[] = [];
  const recovered: string[] = [];

  for (const id of live) {
    const p = prev.get(id);
    if (p === undefined) {
      added.push(id);
    } else if (p.missing >= 1) {
      recovered.push(id);
    }
  }
  for (const [id, p] of prev) {
    if (live.has(id)) continue;
    if (p.missing >= 1) delisted.push(id);
    else missingFirst.push(id);
  }
  return { added, delisted, missingFirst, recovered };
}
