#!/usr/bin/env node
// CLI 包装:node scripts/cron-expr.mjs [minutes] → stdout 仅输出 cron 表达式。
// CI(deploy.yml)用它把 workflow_dispatch 的 cron_minutes 转成表达式,再 sed 进 wrangler.toml。
//
// 契约(spec:product/scheduling.md):
//   - 无参 / 空串 / 非法输入 → 输出兜底 "*/30 * * * *" 且退出码 0(CI 兜底语义,不让部署失败);
//   - 合法分钟数 → 与 src/lib/cron.ts 的 minutesToCron 完全一致(直接 import 同一实现,单一事实来源);
//   - stdout 只有一行表达式;警告走 stderr。
//
// 依赖 node ≥ 23.6 的原生类型剥离直接 import .ts(本机与 CI 均 node 24)。
import { FALLBACK_CRON, minutesToCron } from '../src/lib/cron.ts';

const raw = process.argv[2];
const expr = minutesToCron(raw);

if (expr === FALLBACK_CRON && raw !== undefined && raw !== '') {
  console.error(
    `[cron-expr] 警告:输入 ${JSON.stringify(raw)} 无效,使用兜底表达式 ${FALLBACK_CRON}`,
  );
}
console.log(expr);
