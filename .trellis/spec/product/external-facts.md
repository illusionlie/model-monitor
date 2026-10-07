# 已核实的外部事实(2026-10-07,过期请重核)

> 原 `DECISIONS.md` §9(2026-10-07 迁入)。**核实纪律**:下表事实最近核实于 2026-10-07(models.dev、send_email、observability 行;其余为 2026-10-06);使用时若怀疑过期,重新核实而不是凭记忆。更新时改数值并同步本文件的核实日期。

| 事实 | 数值/结论 |
|---|---|
| OpenRouter `/api/v1/models` | 免鉴权 200;~772KB;464 模型;无 ETag(需自做 hash);含 `created`(真实) |
| models.dev `/models.json` | 200;~409KB;application/json;顶层扁平 `lab/model → 富字段` 字典(2026-10-07 经代理实测)。旧 `/api.json`(~5.3MB,provider→models 二层字典)仍可用,normalize 兼容 |
| OpenCode Zen `https://opencode.ai/zen/v1/models` | 免鉴权 200;86 模型;**`created` 是响应生成时刻(全同值且随请求变化),是噪声,不可作信号** |
| Cline Provider `https://api.cline.bot/api/v1/models` | 免鉴权 200;464 模型;id 为 `vendor/model` 式;`created` 真实(375 个不同值)。注意 ClinePass 是订阅档、非 API |
| Workers 免费档 | cron 5 个/账号;subrequest 50/次调用(**KV/D1 binding 也计入**);10 万请求/天;CPU 10ms/次(允许偶发突发) |
| Workers observability(logs/traces) | Logs 免费档 20 万事件/天、3 天保留(超限当日拒绝写入,次日重置,无超额扣费);Traces 早期 beta、无需付费计划、7 天保留;2026-12-01 起 traces 并入 Cloudflare Observability 计费(2026-10-07 核实)。本项目量级(cron 数十次/天 + 偶发后台访问)远在额度内 |
| D1 免费档 | 读 500 万行/天;写 10 万行/天;5GB |
| send_email binding | 免费走 **Email Routing** 路径:发"已验证目的地"免费且不计配额;Email Service(Onboard Domain 发件)在 Dashboard 标注需 Workers Paid,免费档不用它(2026-10-07 账内核实)。结构化对象 `{to,from,subject,html,text}` 经 Email Routing 路径实测送达(HTML+text 双部分)。新账号无公开固定日额度(信誉制);成功信件在 Email Routing 统计里显示为 dropped(已知怪癖) |
| Resend 免费 | 3000 封/月、100 封/天硬顶;resend.dev 仅发本人 |
| Telegram | sendMessage ≤4096 字符(实体解析后);HTML 模式支持含 `<blockquote expandable>`;同 chat ≤1 条/秒,群组 ≤20 条/分 |

来源:developers.cloudflare.com(workers/platform/limits、workers/platform/pricing、workers/observability/traces、email-routing/email-workers/send-email-workers、email-routing/limits、email-service/api/send-emails/workers-api、email-service/platform/pricing、kv/platform/pricing)· resend.com/pricing 及官方 KB · core.telegram.org/bots/api 与 Bots FAQ · opencode.ai/docs/zen · docs.cline.bot/api。
