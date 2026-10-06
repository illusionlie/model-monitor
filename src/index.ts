/**
 * Worker 入口(design §2):
 * - scheduled:cron 触发 → runOnce(注入真实通知钩子;整体 try/catch,cron 不静默崩,design §11)
 * - fetch:Hono app(setup / admin / feed,detail 见 admin/routes.ts)
 */
import type { Env } from './env';
import app from './app';
import { runOnce } from './poll/engine';
import { makeNotifyHooks } from './notify/dispatch';

export default {
  async scheduled(_controller: ScheduledController, env: Env, _ctx: ExecutionContext): Promise<void> {
    try {
      const summary = await runOnce(env, { holder: 'cron', notifyHooks: makeNotifyHooks(env) });
      if (summary.locked) return;
      console.log(
        `[cron] done: ${summary.sources
          .map((s) => `${s.sourceName}=${s.outcome}`)
          .join(', ')}; events=${summary.eventsInserted}; weekly=${summary.weeklySent ?? '-'}`,
      );
    } catch (err) {
      console.error('[cron] runOnce 未捕获异常:', err);
    }
  },

  fetch(request: Request, env: Env, ctx: ExecutionContext): Response | Promise<Response> {
    return app.fetch(request, env, ctx);
  },
};
