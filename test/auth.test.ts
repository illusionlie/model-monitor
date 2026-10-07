import { describe, expect, it } from 'vitest';
import {
  issueSessionToken,
  SESSION_TTL_MS,
  verifyAdminPassword,
  verifySessionToken,
} from '../src/admin/auth';
import { pbkdf2Hash, pbkdf2Verify, timingSafeEqual } from '../src/lib/crypto';

const SECRET = 'a'.repeat(64); // 256bit hex
const OTHER_SECRET = 'b'.repeat(64);

describe('PBKDF2 管理密码(design §9:100k iter(workerd 生产上限)/ 常时比较)', () => {
  it('正确密码 → true;错误密码 → false', async () => {
    const stored = await pbkdf2Hash('correct horse battery staple');
    expect(stored.iterations).toBe(100_000);
    expect(await pbkdf2Verify('correct horse battery staple', stored)).toBe(true);
    expect(await pbkdf2Verify('wrong password', stored)).toBe(false);
    expect(await pbkdf2Verify('', stored)).toBe(false);
  });

  it('同密码两次 hash,salt 不同 → 散布不同', async () => {
    const a = await pbkdf2Hash('pw');
    const b = await pbkdf2Hash('pw');
    expect(a.salt).not.toBe(b.salt);
    expect(a.hash).not.toBe(b.hash);
  });

  it('timingSafeEqual:相等 true;不等 false;长度不同也 false(不抛异常)', () => {
    expect(timingSafeEqual('abc123', 'abc123')).toBe(true);
    expect(timingSafeEqual('abc123', 'abc124')).toBe(false);
    expect(timingSafeEqual('short', 'a-much-longer-value')).toBe(false);
    expect(timingSafeEqual('', '')).toBe(true);
  });

  it('verifyAdminPassword:合法存储 JSON / 非法 JSON / 缺省', async () => {
    const stored = JSON.stringify(await pbkdf2Hash('pw12345678'));
    expect(await verifyAdminPassword('pw12345678', stored)).toBe(true);
    expect(await verifyAdminPassword('nope', stored)).toBe(false);
    expect(await verifyAdminPassword('pw12345678', 'not json')).toBe(false);
    expect(await verifyAdminPassword('pw12345678', JSON.stringify({ salt: 'zz' }))).toBe(false); // 字段缺失
    expect(await verifyAdminPassword('pw12345678', undefined)).toBe(false);
    expect(await verifyAdminPassword('pw12345678', null)).toBe(false);
  });
});

describe('session cookie mm_session(design §9:HMAC 签名 + exp)', () => {
  it('签发 → 校验通过;exp = now + 7 天', async () => {
    const now = Date.parse('2026-10-06T12:00:00Z');
    const token = await issueSessionToken(SECRET, now);
    const [payload] = token.split('.');
    expect(payload).toBeTruthy();
    expect(await verifySessionToken(token, SECRET, now)).toBe(true);
    expect(await verifySessionToken(token, SECRET, now + SESSION_TTL_MS - 1)).toBe(true);
  });

  it('过期 cookie → false(exp 边界)', async () => {
    const now = Date.parse('2026-10-06T12:00:00Z');
    const token = await issueSessionToken(SECRET, now);
    expect(await verifySessionToken(token, SECRET, now + SESSION_TTL_MS)).toBe(false);
    expect(await verifySessionToken(token, SECRET, now + 10 * SESSION_TTL_MS)).toBe(false);
  });

  it('篡改 payload(HMAC 失配)→ false', async () => {
    const now = Date.now();
    const token = await issueSessionToken(SECRET, now);
    const [payload, sig] = token.split('.');
    // 篡改 exp 为远期
    const fake = payload.slice(0, -4) + '9999';
    expect(await verifySessionToken(`${fake}.${sig}`, SECRET, now)).toBe(false);
  });

  it('篡改签名 → false;换 secret(改密码后)→ 旧 token 全失效', async () => {
    const now = Date.now();
    const token = await issueSessionToken(SECRET, now);
    const [payload, sig] = token.split('.');
    expect(await verifySessionToken(`${payload}.${sig.slice(0, -2)}ff`, SECRET, now)).toBe(false);
    expect(await verifySessionToken(token, OTHER_SECRET, now)).toBe(false); // 改密码 = 换 secret
  });

  it('畸形 token / 空值 → false(不抛异常)', async () => {
    const now = Date.now();
    expect(await verifySessionToken('', SECRET, now)).toBe(false);
    expect(await verifySessionToken(undefined, SECRET, now)).toBe(false);
    expect(await verifySessionToken(null, SECRET, now)).toBe(false);
    expect(await verifySessionToken('nodots', SECRET, now)).toBe(false);
    expect(await verifySessionToken('a.', SECRET, now)).toBe(false);
    expect(await verifySessionToken('.sig', SECRET, now)).toBe(false);
  });
});
