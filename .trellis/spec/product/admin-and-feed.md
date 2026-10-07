# 后台与 Feed(同一 Worker 内的路由,不是独立应用)

> 原 `DECISIONS.md` §6 + §8(2026-10-07 迁入),措辞保持设计定稿原文。

## 后台

- 自管密码鉴权:PBKDF2(WebCrypto)+ 时序安全比较 + session cookie。**不用** Cloudflare Access、不用 better-auth。
- 路由:`/setup`——仅未初始化时开放(设管理密码 → 填通知配置),完成后永久关闭;`/admin`——设置、源管理(增删渠道源、渠道编辑:名称/端点/API Key/自定义请求头,改 URL 静默重接入)、最近事件列表、**立即运行**、**发送测试通知**;`/feed` 见下文。
- scheduled 与"立即运行"共享同一执行函数;路由触发时需与 cron 触发互斥(避免撞车)。

## Feed

- `GET /feed`,secret header 鉴权:事件列表(时间倒序)+ 每源统计(当前模型总数、last_success)。RSS 二期。
