/**
 * 三类源响应 → NormalizedModel[](design §2 / implement.md A-6):
 * - 目录源(结构自适配):`{data:[{id,...}]}` 列表式(OpenRouter);
 *   字典式按条目分派——`{provider → {models:{slug → 字段}}}` 二层(models.dev /api.json,id=`{provider}/{slug}` 若无前缀)
 *   或 `{lab/model → 富字段}` 扁平(models.dev /models.json,id=键,provider=首个 `/` 前缀)
 * - 渠道源:`{data:[{id,...}]}`,只认 id(created 不可信,spec:product/data-sources.md)
 * 判定永远只看 id 集合;富字段只进 snapshot 供展示。
 */
import type { SourceKind } from '../db/sources';

export interface NormalizedModel {
  id: string;
  provider: string | null; // 目录源 = id 前缀 / provider 名;渠道源可空
  snapshot: string | null; // 富字段 JSON(仅展示),null = 无
}

export class ResponseParseError extends Error {}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch (e) {
    throw new ResponseParseError(`JSON 解析失败: ${e instanceof Error ? e.message : String(e)}`);
  }
}

/** 挑选富字段做精简快照,避免行体积膨胀 */
function pickSnapshot(src: Record<string, unknown>, keys: readonly string[]): string | null {
  const out: Record<string, unknown> = {};
  let any = false;
  for (const k of keys) {
    const v = src[k];
    if (v !== undefined && v !== null) {
      out[k] = v;
      any = true;
    }
  }
  return any ? JSON.stringify(out) : null;
}

/** OpenRouter 式列表:`{data:[{id:'openai/gpt-4o', name, created, context_length, ...}]}` */
function normalizeListCatalog(json: unknown): NormalizedModel[] {
  if (!isRecord(json) || !Array.isArray(json.data)) {
    throw new ResponseParseError('目录响应缺少 data 数组');
  }
  const out: NormalizedModel[] = [];
  const seen = new Set<string>();
  for (const item of json.data) {
    if (!isRecord(item) || typeof item.id !== 'string' || !item.id) continue;
    const id = item.id;
    if (seen.has(id)) continue; // 响应内重复 id 只留首个
    seen.add(id);
    const slash = id.indexOf('/');
    out.push({
      id,
      provider: slash > 0 ? id.slice(0, slash) : null,
      snapshot: pickSnapshot(item, ['name', 'created', 'context_length']),
    });
  }
  return out;
}

/**
 * 字典式目录,按条目分派:
 * - 二层(/api.json):值为 record 且含 record `.models` → `{provider → {models:{slug → 字段}}}`,
 *   扁平化后无前缀 slug 补 `{provider}/`(旧行为,不回退)
 * - 扁平(/models.json):键含 `/` 且值为 record(无 `.models`)→ id=键,provider=首个 `/` 的前缀,
 *   snapshot 挑 name/release_date。provider 名不含 `/`,二层字典键天然不会误判为扁平条目
 * - 其余条目(键不含 `/`、值非 record)跳过
 */
function normalizeDictCatalog(json: unknown): NormalizedModel[] {
  if (!isRecord(json)) throw new ResponseParseError('目录响应不是对象');
  const out: NormalizedModel[] = [];
  const seen = new Set<string>();
  for (const [key, value] of Object.entries(json)) {
    if (!isRecord(value)) continue;
    if (isRecord(value.models)) {
      for (const [slug, detail] of Object.entries(value.models)) {
        if (!slug) continue;
        const id = slug.includes('/') ? slug : `${key}/${slug}`;
        if (seen.has(id)) continue;
        seen.add(id);
        out.push({
          id,
          provider: key,
          snapshot: isRecord(detail) ? pickSnapshot(detail, ['name', 'release_date']) : null,
        });
      }
      continue;
    }
    if (!key.includes('/')) continue; // 无 '/' 的键(provider 名形态)不是模型条目
    if (seen.has(key)) continue;
    seen.add(key);
    const slash = key.indexOf('/');
    out.push({
      id: key,
      provider: slash > 0 ? key.slice(0, slash) : null,
      snapshot: pickSnapshot(value, ['name', 'release_date']),
    });
  }
  return out;
}

/** 渠道源(OpenAI 兼容):`{data:[{id,...}]}`,只认 id */
function normalizeChannel(json: unknown): NormalizedModel[] {
  if (!isRecord(json) || !Array.isArray(json.data)) {
    throw new ResponseParseError('渠道响应缺少 data 数组');
  }
  const out: NormalizedModel[] = [];
  const seen = new Set<string>();
  for (const item of json.data) {
    if (!isRecord(item) || typeof item.id !== 'string' || !item.id) continue;
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    out.push({ id: item.id, provider: null, snapshot: pickSnapshot(item, ['created']) });
  }
  return out;
}

export function normalizeResponse(kind: SourceKind, text: string): NormalizedModel[] {
  const json = parseJson(text);
  if (kind === 'channel') return normalizeChannel(json);
  // 目录源结构自适配:data 数组(OpenRouter)、二层字典(/api.json)或扁平字典(/models.json)
  if (isRecord(json) && Array.isArray(json.data)) return normalizeListCatalog(json);
  return normalizeDictCatalog(json);
}

/** allowlist(provider 白名单)仅作用于目录源;空 = 全量(含 trim 后全为空白的情况,spec:product/data-sources.md) */
export function applyAllowlist(models: NormalizedModel[], allowlist: readonly string[]): NormalizedModel[] {
  const allow = new Set(allowlist.map((p) => p.trim().toLowerCase()).filter(Boolean));
  if (allow.size === 0) return models;
  return models.filter((m) => m.provider !== null && allow.has(m.provider.toLowerCase()));
}
