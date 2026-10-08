# 后台与 Feed(同一 Worker 内的路由,不是独立应用)

> 原 `DECISIONS.md` §6 + §8(2026-10-07 迁入),措辞保持设计定稿原文。

## 后台

- 自管密码鉴权:PBKDF2(WebCrypto)+ 时序安全比较 + session cookie。**不用** Cloudflare Access、不用 better-auth。
- 路由:`/setup`——仅未初始化时开放(设管理密码 → 填通知配置),完成后永久关闭;`/admin`——设置、源管理(增删渠道源、渠道编辑:名称/端点/API Key/自定义请求头,改 URL 静默重接入)、最近事件列表、**立即运行**、**发送测试通知**;`/feed` 见下文。
- scheduled 与"立即运行"共享同一执行函数;路由触发时需与 cron 触发互斥(避免撞车)。

## Feed

- `GET /feed`,secret header 鉴权:事件列表(时间倒序)+ 每源统计(当前模型总数、last_success)。RSS 二期。

## 公开主页(2026-10-08 新增)

- `GET /` 无鉴权落地页:品牌区(服务名 + 一句话定位)+ 三点能力简介(目录+渠道双类源、Telegram 与邮件通知、密码保护后台)+「进入后台」入口与 GitHub 仓库链接;未初始化(全新部署)同样可用,三个数字为 0。
- 三个聚合数字,**单条 SQL 子查询合并**:启用源数(`sources.enabled=1`)、在架模型数(`models.missing=0`)、近 24h `added`+`delisted` 事件数(seed/source_fail/source_recovered/notify_fail 系统类不计数)。
- 免费档预算:缓存未命中恰 **1 条 D1 语句**;Cache API(`caches.default`,60s)整页缓存防刷,命中 0 条 D1;环境不支持 caches 或读写失败一律优雅降级直查,页面不受影响。
- 信息暴露边界:公开内容仅上述三个聚合数字;源名 / base_url / 模型 ID / 事件内容 / settings 值一律不入页(能力简介也不点名具体目录源)。
- 未知路径仍 JSON 404;`/setup`、`/admin`、`/feed` 行为不变。
