/**
 * WebCrypto 工具(全部无外部依赖,Workers / Node 通用):
 * - sha256Hex:响应体 hash 短路(DECISIONS §4 硬要求)
 * - PBKDF2(210k iter)+ 常时比较:后台密码(design §9)
 * - HMAC-SHA256:无状态 session cookie 签名(design §9)
 */
const encoder = new TextEncoder();

export function toHex(bytes: Uint8Array): string {
  let out = '';
  for (const b of bytes) out += b.toString(16).padStart(2, '0');
  return out;
}

export function fromHex(hex: string): Uint8Array {
  if (hex.length % 2 !== 0) throw new Error('invalid hex string');
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

/** SHA-256 → hex。字符串按 UTF-8 编码。 */
export async function sha256Hex(data: string | ArrayBuffer | Uint8Array): Promise<string> {
  const buf =
    typeof data === 'string' ? encoder.encode(data) : data instanceof Uint8Array ? data : new Uint8Array(data);
  const digest = await crypto.subtle.digest('SHA-256', buf);
  return toHex(new Uint8Array(digest));
}

/** 随机 token(hex),session_secret / feed_secret 用 */
export function randomToken(bytes = 32): string {
  const arr = new Uint8Array(bytes);
  crypto.getRandomValues(arr);
  return toHex(arr);
}

/** 逐字节 XOR 常时比较(长度差也折进结果,不提前返回) */
export function timingSafeEqual(a: string, b: string): boolean {
  const ab = encoder.encode(a);
  const bb = encoder.encode(b);
  const len = Math.max(ab.length, bb.length);
  let diff = ab.length ^ bb.length;
  for (let i = 0; i < len; i++) {
    diff |= (ab[i] ?? 0) ^ (bb[i] ?? 0);
  }
  return diff === 0;
}

export interface Pbkdf2Stored {
  salt: string; // hex
  hash: string; // hex(256bit)
  iterations: number;
}

async function pbkdf2Derive(password: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const keyMaterial = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, [
    'deriveBits',
  ]);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations },
    keyMaterial,
    256,
  );
  return new Uint8Array(bits);
}

/** 生成 PBKDF2-SHA256 口令散布(design §9:210_000 iter / 16B salt) */
export async function pbkdf2Hash(
  password: string,
  iterations = 210_000,
  saltBytes = 16,
): Promise<Pbkdf2Stored> {
  const salt = crypto.getRandomValues(new Uint8Array(saltBytes));
  const hash = await pbkdf2Derive(password, salt, iterations);
  return { salt: toHex(salt), hash: toHex(hash), iterations };
}

export async function pbkdf2Verify(password: string, stored: Pbkdf2Stored): Promise<boolean> {
  const derived = await pbkdf2Derive(password, fromHex(stored.salt), stored.iterations);
  return timingSafeEqual(toHex(derived), stored.hash);
}

async function hmacKey(secretHex: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    fromHex(secretHex),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  );
}

export async function hmacSign(payload: string, secretHex: string): Promise<string> {
  const sig = await crypto.subtle.sign('HMAC', await hmacKey(secretHex), encoder.encode(payload));
  return toHex(new Uint8Array(sig));
}

export async function hmacVerify(payload: string, sigHex: string, secretHex: string): Promise<boolean> {
  try {
    return await crypto.subtle.verify('HMAC', await hmacKey(secretHex), fromHex(sigHex), encoder.encode(payload));
  } catch {
    return false;
  }
}
