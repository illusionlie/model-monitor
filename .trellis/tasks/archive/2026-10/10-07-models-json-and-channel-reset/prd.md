# models.dev 换 /models.json 实验室级目录 + 后台清理渠道存量模型

## Goal

两个独立交付物:

1. models.dev 目录源端点从 `/api.json` 切换到 `/models.json`,监控口径从"provider/渠道面"收敛为"实验室级(lab/model)"
2. 后台新增源存量模型清理操作(渠道与目录源均可用)

## Background / Motivation

- 目录源(models.dev、OpenRouter)的产品目的是回答"**有哪些新模型(实验室发布)**",而不是"哪些渠道上架了新模型"。`/api.json` 是全 provider 字典(含 openrouter 等聚合渠道),维度是渠道,产生大量渠道维度的重复面;`/models.json` 是扁平 `lab/model` 字典,天然去渠道化。
- 实测(2026-10-07,经代理):`/models.json` 返回 200、~409KB(application/json),对比 `/api.json` ~5.3MB,大幅省带宽与解析开销。
- 渠道源场景:端点换 key / 换指向后模型集合大变,逐条 delisted+added 通知全是噪声;需要一键清空存量、回到"新源静默接入"状态。

## Requirements

### R1 models.dev 端点切换

- sources 表中 models.dev 目录源 `base_url` 改为 `https://models.dev/models.json`。
- 切换必须静默:不得产生一次性全量 added/delisted 事件或通知。
- normalize 支持新结构:顶层扁平字典 `{lab/model → 富字段}`;id=键,provider='/' 前缀,snapshot 取 `name` / `release_date`。
- 既有结构(OpenRouter 列表式、`/api.json` 二层字典式)解析行为不回退。

### R2 存量模型清理

- 后台可对任意源(渠道源与内置目录源)执行"清理已存模型":删除该源全部 models 行,并置 `seed_done=0`、`last_hash=NULL`。
- 清理后下轮探测走新源路径:静默 seed,仅一条接入确认(seed)事件,无逐条 added/delisted 噪声。
- 清理是非破坏性操作:源配置(base_url/key/启停)与 events 审计记录均不动;"内置目录源不可删除"的保护语义不受影响。

## Constraints

- 免费档纪律:subrequest ≤50/次调用(D1 语句计入),新增写路径须核算语句数。
- SQL 只出现在 `src/db/`;批量写用 `db.batch`。
- 迁移只增不改(0001 已在线上应用);CI 自动应用新增迁移。
- 时间戳一律 UTC ISO;不引入前端构建;客户端 JS 禁用反引号与 `${`。
- 提交前 `npm run typecheck` 0 错误、`npm test` 全绿;新解析行为补边界用例。

## Acceptance Criteria

- [ ] 迁移应用后首轮探测,models.dev 源 outcome=rebaselined:models 表该源行全部为 lab/model 形态,零新增事件、零通知。
- [ ] `normalizeResponse` 解析扁平字典:全部条目、provider 前缀、snapshot 字段正确;不含 '/' 的键跳过;非对象值跳过;0 条目沿用"解析失败"防线。
- [ ] 既有 normalize 用例(列表式 / 二层字典 / 渠道 / 异常输入 / allowlist)全部不回退。
- [ ] `POST /admin/api/sources/:id/reset`:清空目标源 models 并重置 seed 状态(渠道与目录源均可);不存在 404;未登录 401。
- [ ] 清理后的源在下轮 runOnce 走 seed 分支(outcome=seeded,1 条 seed 事件)。
- [ ] 后台 UI 源行(渠道与目录)出现"清理模型"按钮,confirm 后执行并刷新状态。
- [ ] spec 同步:`data-sources.md` 端点行与语义、`external-facts.md` models.dev 行(含实测大小)与核实日期。

## Notes

- 两个交付物可独立实现、独立回滚;共用一次提交。
