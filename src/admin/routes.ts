/**
 * 后台路由(design §9,全部挂同一 Worker):
 * - /setup:仅 settings 无 admin_password 时开放;成功后永久关闭(已初始化一律 404)
 * - /admin/login、/admin/logout、GET /admin(未登录渲染登录页)
 * - /admin/api/*:state / settings / sources / run / test-notify / feed-secret(写操作均过 cookie 鉴权)
 * - /feed:X-Feed-Secret 头常时比较;JSON:事件倒序 100 + 每源统计
 * 写口诀:改密码 = 重生成 session_secret(全部旧会话失效)。
 */
import type { Context, MiddlewareHandler } from 'hono';
import type { Hono } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import type { Env } from '../env';
import { getSettings, parseAllowlistSetting, parseBool, saveSettings, type SettingsMap } from '../db/settings';
import {
  createChannelSource,
  deleteChannelSource,
  getSource,
  listAllSources,
  markCatalogsRebaseline,
  setSourceEnabled,
} from '../db/sources';
import { countModelsBySource } from '../db/models';
import { recentEvents } from '../db/events';
import { pbkdf2Hash, randomToken, timingSafeEqual } from '../lib/crypto';
import { runOnce } from '../poll/engine';
import { makeNotifyHooks, sendTestNotification } from '../notify/dispatch';
import { SESSION_COOKIE, SESSION_TTL_MS, issueSessionToken, verifyAdminPassword, verifySessionToken } from './auth';
import { renderAdminPage, renderLoginPage, renderSetupPage } from './ui';

const nowIso = (): string => new Date().toISOString();

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

async function readJsonBody(c: Context): Promise<Record<string, unknown> | null> {
  try {
    const v: unknown = await c.req.json();
    return isRecord(v) ? v : null;
  } catch {
    return null;
  }
}

/** 当前请求是否持有有效会话(session_secret 缺失 = 未初始化,一律拒绝) */
async function isAuthed(c: Context): Promise<boolean> {
  const settings = await getSettings(c.env.DB);
  const secret = settings['session_secret'];
  if (!secret) return false;
  return verifySessionToken(getCookie(c, SESSION_COOKIE), secret);
}

/** admin 写/读 API 中间件 */
const requireAuth: MiddlewareHandler<{ Bindings: Env }> = async (c, next) => {
  if (!(await isAuthed(c))) return c.json({ error: 'unauthorized' }, 401);
  await next();
};

function setSessionCookie(c: Context, token: string): void {
  setCookie(c, SESSION_COOKIE, token, {
    httpOnly: true,
    secure: true,
    sameSite: 'Strict',
    path: '/',
    maxAge: Math.floor(SESSION_TTL_MS / 1000),
  });
}

/** allowlist 归一化:trim/lowercase/去空/去重/排序 → 数组;非法输入返回 null */
function normalizeAllowlistInput(input: unknown): string[] | null {
  let raw: unknown[] | null = null;
  if (Array.isArray(input)) raw = input;
  else if (typeof input === 'string') raw = input.split(/[\n,]/);
  else return null;
  return [...new Set(raw.filter((x): x is string => typeof x === 'string').map((s) => s.trim().toLowerCase()).filter(Boolean))].sort();
}

export function registerRoutes(app: Hono<{ Bindings: Env }>): void {
  // ---------- /setup ----------
  app.get('/setup', async (c) => {
    const settings = await getSettings(c.env.DB);
    if (settings['admin_password']) return c.text('Not Found', 404);
    return c.html(renderSetupPage());
  });

  app.post('/setup', async (c) => {
    const db = c.env.DB;
    const settings = await getSettings(db);
    if (settings['admin_password']) return c.json({ error: 'not_found' }, 404);
    const body = await readJsonBody(c);
    if (!body) return c.json({ error: 'bad_request' }, 400);
    const password = typeof body.password === 'string' ? body.password : '';
    if (password.length < 8) return c.json({ error: '密码至少 8 位' }, 400);

    // 并发保护:admin_password 条件插入,已存在则视为已初始化
    const stored = JSON.stringify(await pbkdf2Hash(password));
    const ins = await db
      .prepare(`INSERT INTO settings (k, v, updated_at) VALUES ('admin_password', ?, ?) ON CONFLICT(k) DO NOTHING`)
      .bind(stored, nowIso())
      .run();
    if ((ins.meta?.changes ?? 0) === 0) return c.json({ error: 'not_found' }, 404);

    const updates: Record<string, string> = {
      session_secret: randomToken(32),
      feed_secret: randomToken(24),
      setup_done: 'true',
    };
    const optionalStrings = ['tg_bot_token', 'tg_chat_id', 'email_transport', 'email_from', 'email_to', 'resend_api_key'];
    for (const k of optionalStrings) {
      const v = body[k];
      if (typeof v === 'string' && v.trim()) updates[k] = v.trim();
    }
    for (const k of ['tg_realtime', 'tg_weekly', 'email_realtime', 'email_weekly']) {
      if (body[k] === true) updates[k] = 'true';
    }
    await saveSettings(db, updates, nowIso());

    setSessionCookie(c, await issueSessionToken(updates['session_secret']!));
    console.log('[admin] setup 完成');
    return c.json({ ok: true });
  });

  // ---------- 登录 / 登出 ----------
  app.post('/admin/login', async (c) => {
    const settings = await getSettings(c.env.DB);
    if (!settings['session_secret']) return c.json({ error: '未初始化,请先完成 /setup' }, 404);
    const body = await readJsonBody(c);
    const password = body && typeof body.password === 'string' ? body.password : '';
    if (!password || !(await verifyAdminPassword(password, settings['admin_password']))) {
      return c.json({ error: '密码错误' }, 401);
    }
    setSessionCookie(c, await issueSessionToken(settings['session_secret']));
    return c.json({ ok: true });
  });

  app.post('/admin/logout', (c) => {
    deleteCookie(c, SESSION_COOKIE, { path: '/' });
    return c.json({ ok: true });
  });

  // ---------- 页面 ----------
  app.get('/admin', async (c) => {
    const settings = await getSettings(c.env.DB);
    if (!settings['session_secret']) return c.redirect('/setup');
    if (await isAuthed(c)) return c.html(renderAdminPage());
    return c.html(renderLoginPage());
  });

  // ---------- admin API(全部过鉴权) ----------
  app.use('/admin/api/*', requireAuth);

  app.get('/admin/api/state', async (c) => {
    const db = c.env.DB;
    const [settings, sources, events, counts] = await Promise.all([
      getSettings(db),
      listAllSources(db),
      recentEvents(db, 50),
      countModelsBySource(db),
    ]);
    return c.json({
      setup_done: parseBool(settings['setup_done']),
      settings: {
        tg_chat_id: settings['tg_chat_id'] ?? '',
        tg_realtime: parseBool(settings['tg_realtime']),
        tg_weekly: parseBool(settings['tg_weekly']),
        has_tg_bot_token: Boolean(settings['tg_bot_token']?.trim()),
        email_transport: settings['email_transport'] ?? 'send_email',
        email_from: settings['email_from'] ?? '',
        email_to: settings['email_to'] ?? '',
        email_realtime: parseBool(settings['email_realtime']),
        email_weekly: parseBool(settings['email_weekly']),
        has_resend_api_key: Boolean(settings['resend_api_key']?.trim()),
        allowlist: parseAllowlistSetting(settings['allowlist']),
        event_added_enabled: parseBool(settings['event_added_enabled'], true),
        event_delisted_enabled: parseBool(settings['event_delisted_enabled'], true),
        feed_secret: settings['feed_secret'] ?? '',
        weekly_last_sent: settings['weekly_last_sent'] ?? null,
      },
      sources: sources.map((s) => ({
        id: s.id,
        kind: s.kind,
        name: s.name,
        base_url: s.base_url,
        has_api_key: Boolean(s.api_key),
        enabled: s.enabled === 1,
        seed_done: s.seed_done === 1,
        rebaseline: s.rebaseline === 1,
        last_success: s.last_success,
        last_error: s.last_error,
        consecutive_failures: s.consecutive_failures,
        model_count: counts.get(s.id) ?? 0,
      })),
      events: events.map((e) => ({
        id: e.id,
        source_name: e.source_name,
        kind: e.kind,
        model_id: e.model_id,
        suppressed: e.suppressed === 1,
        notified: e.notified === 1,
        detected_at: e.detected_at,
      })),
    });
  });

  app.put('/admin/api/settings', async (c) => {
    const db = c.env.DB;
    const body = await readJsonBody(c);
    if (!body) return c.json({ error: 'bad_request' }, 400);
    const settings = await getSettings(db);
    const updates: Record<string, string> = {};

    // 布尔开关
    for (const k of ['tg_realtime', 'tg_weekly', 'email_realtime', 'email_weekly', 'event_added_enabled', 'event_delisted_enabled']) {
      if (body[k] !== undefined) updates[k] = body[k] === true || body[k] === 'true' ? 'true' : 'false';
    }
    // 非机密字符串:照存(允许清空)
    for (const k of ['tg_chat_id', 'email_transport', 'email_from', 'email_to']) {
      if (typeof body[k] === 'string') updates[k] = (body[k] as string).trim();
    }
    // 机密:留空 = 不修改
    for (const k of ['tg_bot_token', 'resend_api_key']) {
      const v = body[k];
      if (typeof v === 'string' && v.trim()) updates[k] = v.trim();
    }

    // allowlist:归一化后比对,实际变更 → 目录源置 rebaseline=1(下轮静默全量重建)
    let rebaseline = false;
    if (body['allowlist'] !== undefined) {
      const next = normalizeAllowlistInput(body['allowlist']);
      if (!next) return c.json({ error: 'allowlist 格式非法' }, 400);
      const prev = normalizeAllowlistInput(JSON.stringify(parseAllowlistSetting(settings['allowlist']))) ?? [];
      const changed = JSON.stringify(next) !== JSON.stringify(prev);
      updates['allowlist'] = JSON.stringify(next);
      if (changed) rebaseline = true;
    }

    // 改密码 = 重生成 session_secret(全旧会话失效);当前会话用新 secret 签发续期
    let reissueCookie = false;
    if (body['new_password'] !== undefined) {
      const pw = body['new_password'];
      if (typeof pw !== 'string' || pw.length < 8) return c.json({ error: '新密码至少 8 位' }, 400);
      updates['admin_password'] = JSON.stringify(await pbkdf2Hash(pw));
      updates['session_secret'] = randomToken(32);
      reissueCookie = true;
    }

    if (Object.keys(updates).length > 0) await saveSettings(db, updates, nowIso());
    if (rebaseline) {
      const n = await markCatalogsRebaseline(db, nowIso());
      console.log(`[admin] allowlist 变更 → ${n} 个目录源置 rebaseline=1`);
    }
    if (reissueCookie && updates['session_secret']) {
      setSessionCookie(c, await issueSessionToken(updates['session_secret']));
    }
    return c.json({ ok: true, rebaseline });
  });

  app.post('/admin/api/sources', async (c) => {
    const body = await readJsonBody(c);
    if (!body) return c.json({ error: 'bad_request' }, 400);
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    const baseUrl = typeof body.base_url === 'string' ? body.base_url.trim() : '';
    const apiKey = typeof body.api_key === 'string' && body.api_key.trim() ? body.api_key.trim() : null;
    if (!name || name.length > 64) return c.json({ error: '名称必填(≤64 字符)' }, 400);
    if (!/^https?:\/\//.test(baseUrl) || baseUrl.length > 512)
      return c.json({ error: 'base_url 必须是 http(s) 端点(≤512 字符)' }, 400);
    const id = await createChannelSource(c.env.DB, { name, base_url: baseUrl, api_key: apiKey }, nowIso());
    console.log(`[admin] 新增渠道源 ${name} → id=${id}`);
    return c.json({ ok: true, id });
  });

  app.delete('/admin/api/sources/:id', async (c) => {
    const id = Number(c.req.param('id'));
    if (!Number.isInteger(id) || id <= 0) return c.json({ error: 'bad_id' }, 400);
    const src = await getSource(c.env.DB, id);
    if (!src) return c.json({ error: 'not_found' }, 404);
    if (src.kind !== 'channel') return c.json({ error: '内置目录源不可删除,只可启停' }, 400);
    await deleteChannelSource(c.env.DB, id);
    console.log(`[admin] 删除渠道源 ${src.name}(id=${id})`);
    return c.json({ ok: true });
  });

  app.patch('/admin/api/sources/:id', async (c) => {
    const id = Number(c.req.param('id'));
    if (!Number.isInteger(id) || id <= 0) return c.json({ error: 'bad_id' }, 400);
    const body = await readJsonBody(c);
    if (!body || typeof body.enabled !== 'boolean') return c.json({ error: '需要 {enabled: boolean}' }, 400);
    const src = await getSource(c.env.DB, id);
    if (!src) return c.json({ error: 'not_found' }, 404);
    await setSourceEnabled(c.env.DB, id, body.enabled, nowIso());
    return c.json({ ok: true });
  });

  app.post('/admin/api/run', async (c) => {
    // 与 scheduled 共享 runOnce(同一 run_lock 互斥;占用 → 409)
    const summary = await runOnce(c.env, { holder: 'manual', notifyHooks: makeNotifyHooks(c.env) });
    if (summary.locked) return c.json({ error: 'locked', hint: '另一轮探测正在执行(cron 或手动),稍后再试' }, 409);
    return c.json({ ok: true, summary });
  });

  app.post('/admin/api/test-notify', async (c) => {
    const settings = await getSettings(c.env.DB);
    const result = await sendTestNotification(c.env, settings);
    return c.json({ ok: true, ...result });
  });

  app.post('/admin/api/feed-secret', async (c) => {
    const secret = randomToken(24);
    await saveSettings(c.env.DB, { feed_secret: secret }, nowIso());
    return c.json({ ok: true, feed_secret: secret });
  });

  // ---------- /feed ----------
  app.get('/feed', async (c) => {
    const settings: SettingsMap = await getSettings(c.env.DB);
    const provided = c.req.header('X-Feed-Secret') ?? '';
    const stored = settings['feed_secret'];
    if (!stored || !provided || !timingSafeEqual(provided, stored)) {
      return c.json({ error: 'unauthorized' }, 401);
    }
    const db = c.env.DB;
    const [events, sources, counts] = await Promise.all([
      recentEvents(db, 100),
      listAllSources(db),
      countModelsBySource(db),
    ]);
    return c.json({
      generated_at: nowIso(),
      events: events.map((e) => ({
        id: e.id,
        source_name: e.source_name,
        kind: e.kind,
        model_id: e.model_id,
        suppressed: e.suppressed === 1,
        notified: e.notified === 1,
        payload: e.payload,
        detected_at: e.detected_at,
      })),
      sources: sources.map((s) => ({
        id: s.id,
        name: s.name,
        kind: s.kind,
        enabled: s.enabled === 1,
        model_count: counts.get(s.id) ?? 0,
        last_success: s.last_success,
        last_error: s.last_error,
      })),
    });
  });
}
