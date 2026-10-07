# 产品契约(model-monitor)

> 本层是产品契约的唯一权威。前身:仓库根 `DECISIONS.md`(2026-10-06 设计定稿;2026-10-07 整体迁入本层,原文件删除,历史措辞见 git)。
> **契约与语义以本层文件为准**;实现与契约冲突时,以契约为准。`external-facts.md` 中标注"已核实"的外部事实带核实日期,怀疑过期先重核、不要凭记忆。
> **新的设计与决策只写进 `.trellis/spec/`**(产品语义进本层、编码规范进 `backend/` 等对应层),不要再建根级决策记录文件。
> 契约正文保持设计定稿的中文原措辞,不做翻译或改写——改写即变更,须走正常变更流程。

## 定位(原 §0)

自用的 Cloudflare Workers 服务:定时轮询 LLM 模型目录与自有渠道端点,diff 出"新增/下架",经 Telegram 和邮件通知;带一个密码保护的小设置后台。全程跑在免费档。

## 契约文件地图

| 文件 | 内容 | 原节 |
|---|---|---|
| [event-semantics.md](./event-semantics.md) | 事件语义(核心,先读) | §1 |
| [data-sources.md](./data-sources.md) | 数据源、鉴权与 allowlist | §2 |
| [scheduling.md](./scheduling.md) | 单 cron、cron_minutes 映射、周报门控、时间双标注 | §3 |
| [storage.md](./storage.md) | D1-only 存储契约与写纪律 | §4 |
| [notifications.md](./notifications.md) | 通道矩阵、邮件双传输、TG 限制、失败告警、secrets 分区 | §5 |
| [admin-and-feed.md](./admin-and-feed.md) | 后台路由与鉴权、/feed | §6、§8 |
| [deployment.md](./deployment.md) | CI 部署契约(wrangler.example / D1 自动建库 / 迁移) | §7 |
| [external-facts.md](./external-facts.md) | 已核实的外部事实(带核实日期) | §9 |
| [non-goals.md](./non-goals.md) | v1 明确不做 | §10 |
| [acceptance.md](./acceptance.md) | 完成定义(粗粒度验收) | §12 |

## 非契约自由度(原 §11)

以下方面刻意不定死,实现可自由选择与调整:

- wrangler 版本与配置格式(toml/jsonc);D1 migration 文件拆分
- 路由选型(Hono 或裸 fetch router)与目录结构
- session/cookie 细节、PBKDF2 迭代参数(注意:workerd 生产对迭代上限另有硬约束,见 `../backend/index.md` Key Gotchas)
- UI 形态(单页 vanilla 或轻框架)与样式,移动端可用即可
- TG 分段与消息模板、失败分类(网络/4xx/解析)的日志粒度
- cron 分钟→表达式生成函数按 scheduling.md 规则实现并补边界测试
- 时区转换实现(Intl 或 UTC+8 手算)

## 契约变更规则

1. 改产品行为 = 改本层对应文件,并与代码、测试同批提交;受影响的 `backend/` 规范同步更新。
2. 二期立项做某项"不做清单"里的功能时:先把它从 `non-goals.md` 移除,再新增/修订对应契约文件。
3. 外部事实更新:改 `external-facts.md` 的数值并同步核实日期,禁止只凭记忆改。
