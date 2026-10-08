# 存储(D1-only,无 KV)

> 原 `DECISIONS.md` §4(2026-10-07 迁入),措辞保持设计定稿原文。写路径的算账方法与配额推导见 `../backend/database-guidelines.md`。

- 表:`settings`(k-v)、`sources`(类型/base_url/api_key/启用/last_hash/last_success/missing 标记)、`models`(dedup 组归属、first_seen/last_seen、富字段快照)、`events`。
- **diff 在 Worker 内存做,D1 只写变化**——严禁每轮全量 upsert last_seen(免费档 D1 写配额 10 万行/天;两个 ~500 模型的目录 × 48 轮/天会吃掉一半)。
- **body hash 短路是硬要求**:响应体 SHA-256 未变则跳过解析(models.dev 5.3MB;免费档 CPU 10ms/次,官方允许偶发突发但不应依赖)。
- 事件日志 v1 不清理(二期做清理任务)。
- **events 表外键(2026-10-08,migration 0004)**:`source_id` 不再带 `REFERENCES sources(id)`——D1 生产**默认强制外键**(与本地 SQLite 相反),系统级(非源)事件无合法 source_id 可填。约定 `source_id=0` 为系统级事件(首个:`notify_fail`,source_name 记通道名);删除渠道源改由应用层显式删除其 events 行(`db/sources.ts::deleteChannelSource` batch,行为与后台「事件记录一并删除」文案一致),models 行仍走自身 FK 的 CASCADE。
