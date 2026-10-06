/**
 * Hono 装配(design §2/§9):admin / feed / setup 全部路由挂载。
 * engine 的 notifyHooks 注入点在 index.ts(scheduled)与 admin routes(立即运行)。
 */
import { Hono } from 'hono';
import type { Env } from './env';
import { registerRoutes } from './admin/routes';

const app = new Hono<{ Bindings: Env }>();
registerRoutes(app);
app.notFound((c) => c.json({ error: 'not_found' }, 404));

export default app;
