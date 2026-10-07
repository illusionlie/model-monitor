/**
 * 后台鉴权(design §9):
 * - PBKDF2-SHA256 100k iter(workerd 生产上限)verify 管理密码
 * - 无状态签名 cookie mm_session=payload.sig;payload 仅 base64url({"exp":...})(7 天)
 * - HMAC-SHA256(key=session_secret)签名;校验 = 重算 HMAC + 常时比较 + exp
 * - 登出无端点语义:改密码 = 重生成 session_secret → 全部旧会话立即失效
 */
import { hmacSign, hmacVerify, pbkdf2Verify, type Pbkdf2Stored } from '../lib/crypto';

export const SESSION_COOKIE = 'mm_session';
export const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function b64urlEncode(s: string): string {
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64urlDecode(s: string): string {
  const pad = s.length % 4 === 0 ? '' : '='.repeat(4 - (s.length % 4));
  return atob(s.replace(/-/g, '+').replace(/_/g, '/') + pad);
}

/** 签发 token(payload 只含 exp) */
export async function issueSessionToken(secretHex: string, now: number = Date.now()): Promise<string> {
  const payload = b64urlEncode(JSON.stringify({ exp: now + SESSION_TTL_MS }));
  const sig = await hmacSign(payload, secretHex);
  return `${payload}.${sig}`;
}

/** 校验 token:格式 → HMAC 常时验证(subtle.verify;畸形签名 hex 捕获为 false)→ exp */
export async function verifySessionToken(
  token: string | null | undefined,
  secretHex: string,
  now: number = Date.now(),
): Promise<boolean> {
  if (!token) return false;
  const dot = token.lastIndexOf('.');
  if (dot <= 0 || dot === token.length - 1) return false;
  const payload = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  if (!(await hmacVerify(payload, sig, secretHex))) return false;
  try {
    const obj = JSON.parse(b64urlDecode(payload)) as { exp?: unknown };
    if (typeof obj.exp !== 'number' || !Number.isFinite(obj.exp)) return false;
    return obj.exp > now;
  } catch {
    return false;
  }
}

/** 校验管理密码(storedJson = settings.admin_password,JSON: {salt,hash,iterations}) */
export async function verifyAdminPassword(
  password: string,
  storedJson: string | undefined | null,
): Promise<boolean> {
  if (!storedJson) return false;
  try {
    const stored = JSON.parse(storedJson) as Partial<Pbkdf2Stored>;
    if (
      typeof stored.salt !== 'string' ||
      typeof stored.hash !== 'string' ||
      typeof stored.iterations !== 'number' ||
      stored.iterations <= 0
    ) {
      return false;
    }
    return await pbkdf2Verify(password, stored as Pbkdf2Stored);
  } catch {
    return false;
  }
}
