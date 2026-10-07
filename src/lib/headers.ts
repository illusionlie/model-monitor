/**
 * 渠道源自定义请求头(design §1.3):
 * - sanitizeHeaderMap:admin 写路径校验,非法 → null(路由层 400)
 * - parseStoredHeaders:存量容错读,坏 JSON/非平面对象/非法项静默丢弃,绝不抛
 * 规则两端一致:≤16 个;键 trim 后非空、≤128、不含 ':' 与 CR/LF 及其他 C0 控制字符;
 * 值必须是 string、trim 后 ≤1024、不含 CR/LF(CRLF 注入防护;先 trim 再查,首尾换行不算)。
 */

const MAX_COUNT = 16;
const MAX_NAME_LENGTH = 128;
const MAX_VALUE_LENGTH = 1024;

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function normalizeName(raw: string): string | null {
  const name = raw.trim();
  if (!name || name.length > MAX_NAME_LENGTH) return null;
  if (name.includes(':') || /[\u0000-\u001F]/.test(name)) return null;
  return name;
}

function normalizeValue(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const value = raw.trim();
  if (value.length > MAX_VALUE_LENGTH || /[\r\n]/.test(value)) return null;
  return value;
}

/** 存量容错读:整体坏(JSON 解析失败/非平面对象)→ {};逐项坏静默丢弃;大小写重复只留首个 */
export function parseStoredHeaders(json: string | null | undefined): Record<string, string> {
  if (!json) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return {};
  }
  if (!isPlainObject(parsed)) return {};
  const out: Record<string, string> = {};
  const seen = new Set<string>();
  for (const [rawName, rawValue] of Object.entries(parsed)) {
    const name = normalizeName(rawName);
    const value = normalizeValue(rawValue);
    if (name === null || value === null) continue;
    const lower = name.toLowerCase();
    if (seen.has(lower)) continue;
    if (seen.size >= MAX_COUNT) break; // 超上限只可能来自手改库,超出部分丢弃
    seen.add(lower);
    out[name] = value;
  }
  return out;
}

/** 输入校验(admin 写路径):返回归一化对象,非法 → null(= 路由层 400);空对象合法(= 清空) */
export function sanitizeHeaderMap(input: unknown): Record<string, string> | null {
  if (!isPlainObject(input)) return null;
  const out: Record<string, string> = {};
  const seen = new Set<string>();
  for (const [rawName, rawValue] of Object.entries(input)) {
    const name = normalizeName(rawName);
    const value = normalizeValue(rawValue);
    if (name === null || value === null) return null;
    const lower = name.toLowerCase();
    if (seen.has(lower)) return null; // fetch 头大小写不敏感,仅大小写差异的重复键 = 歧义 → 非法
    seen.add(lower);
    out[name] = value;
  }
  return seen.size <= MAX_COUNT ? out : null;
}
