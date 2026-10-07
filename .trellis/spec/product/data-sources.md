# 数据源

> 原 `DECISIONS.md` §2(2026-10-07 迁入),措辞保持设计定稿原文;仅原 §9 交叉引用改指本层文件。

| 源 | 端点 | 鉴权 | 备注 |
|---|---|---|---|
| OpenRouter | `GET https://openrouter.ai/api/v1/models` | 无需(配置仍要求留 key 位) | 富源:pricing/context_length/knowledge_cutoff/benchmarks/reasoning 等字段齐全 |
| models.dev | `GET https://models.dev/api.json` | 无需 | 富源:全 provider 字典,含 release_date/last_updated |
| 渠道源 ×N | `GET {base_url}/models` | 可选 Bearer key | 用户在后台增删;参考对象:OpenCode Zen、Cline Provider |

- 渠道源 diff **只认 id**;`created` 字段不可信作信号(见 [external-facts.md](./external-facts.md) 的 Zen 实测)。
- allowlist(provider 白名单)仅作用于全局目录源,默认全量,存 settings。
