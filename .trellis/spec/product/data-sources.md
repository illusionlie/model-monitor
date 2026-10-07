# 数据源

> 原 `DECISIONS.md` §2(2026-10-07 迁入),措辞保持设计定稿原文;仅原 §9 交叉引用改指本层文件。

| 源 | 端点 | 鉴权 | 备注 |
|---|---|---|---|
| OpenRouter | `GET https://openrouter.ai/api/v1/models` | 无需(配置仍要求留 key 位) | 富源:pricing/context_length/knowledge_cutoff/benchmarks/reasoning 等字段齐全 |
| models.dev | `GET https://models.dev/models.json` | 无需 | 扁平 `lab/model` 字典,含 release_date/last_updated;~409KB(2026-10-07 实测) |
| 渠道源 ×N | `GET {base_url}/models` | 可选 Bearer key + 任意自定义请求头(最后合并、可覆盖内置头,支持非 Bearer 鉴权) | 用户在后台增删;后台可编辑渠道(名称/URL/API Key/头),改 URL 触发静默重接入;参考对象:OpenCode Zen、Cline Provider |

- 渠道源 diff **只认 id**;`created` 字段不可信作信号(见 [external-facts.md](./external-facts.md) 的 Zen 实测)。
- allowlist(provider 白名单)仅作用于全局目录源,默认全量,存 settings。
- 目录源口径 = **实验室级"有哪些新模型"**,不是"哪些渠道上了新模型"。models.dev 因此取 `/models.json`(扁平 `lab/model` 字典);2026-10-07 由 `/api.json`(全 provider 二层字典)切换,迁移 `0002` 置 `rebaseline=1` 静默重建。normalize 对旧二层结构保持兼容。
