# 公开主页(根路径落地页)

## Goal

`GET /` 返回无鉴权主页:品牌区 + 能力简介 + 轻量状态数字(源数/模型数/近 24h 变动数,单条 SQL)+ 进入后台入口;复用 `page()` / BASE_CSS;同步 product 契约。

## 背景

当前 `GET /` 无路由,落入 `app.notFound` 返回 `{"error":"not_found"}` JSON。作为已上线的服务,根路径应有一个任何人可访问的落地页,说明"这是什么服务、状态是否正常、从哪进入后台"。

## Requirements

1. **品牌区**:服务名 `model-monitor` + 一句话定位(定时轮询 LLM 模型目录与渠道端点,新增/下架及时通知)。
2. **状态数字**(轻量动态,读一次 D1):
   - 启用中的监控源数(`sources.enabled = 1`);
   - 在架模型数(`models.missing = 0`);
   - 近 24h 检出的模型变动数(`events.kind IN ('added','delisted') AND detected_at >= now-24h`,不含 seed/source_fail/source_recovered/notify_fail 系统类事件)。
3. **能力简介**:目录 + 渠道双类源、Telegram 与邮件通知、密码保护后台(简短三点,不展开)。
4. **入口**:「进入后台」按钮 → `/admin`;GitHub 仓库链接 `https://github.com/illusionlie/model-monitor`;页脚小字"跑在 Cloudflare Workers 免费档"。

## 约束(硬性)

- **免费档纪律**:单次访问(缓存未命中)**D1 语句 = 1**(三个数字单条 SQL 子查询合并);防刷保护用 Cache API(`caches.default`,TTL ~60s)缓存整页响应,命中则不触发 D1;环境不支持时优雅降级为直查。
- **信息暴露边界**:公开内容仅限上述三个聚合数字;严禁出现源名、base_url、模型 ID、事件内容、任何 settings 值。
- **实现分层**:SQL 只写在 `src/db/`(新增查询函数);渲染函数为纯函数(接收数字参数),放 `src/admin/ui/`(复用 `page()` 骨架 + BASE_CSS,自动继承亮/暗主题三态);路由注册风格随现状(admin/routes.ts 或 app.ts)。
- **不改变既有行为**:其他未知路径仍 JSON 404;`/setup`、`/admin`、`/feed` 零改动。
- 未初始化(全新部署)时主页可用:三个数字为 0,不报错、不跳转。

## Acceptance Criteria

- [ ] `GET /` 返回 200 与完整 HTML,含三个状态数字与服务名;无鉴权、无 cookie 要求。
- [ ] 单次访问 D1 语句数 = 1;缓存命中时为 0(代码审计确认,不强求运行时断言)。
- [ ] 主页 HTML 不含任何源名/端点/模型 ID/事件 payload/机密。
- [ ] 新增 db 查询函数与渲染函数有单测(纯字符串断言随 `test/ui.test.ts` 风格;db 函数用 `test/helpers/d1.ts` stub);含"未初始化全 0"与"kind 过滤不含系统事件"用例。
- [ ] `npm run typecheck` 0 错误;`npm test` 全绿。
- [ ] `.trellis/spec/product/admin-and-feed.md` 增补主页路由语义(无鉴权、三个聚合数字、缓存与 D1 预算),与代码同批提交。

## 非目标

- 不做最近事件/模型列表的公开展示(那是 /feed 带 secret 干的事)。
- 不做访客侧任何交互(登录、订阅、搜索)。
- 不引入前端构建、外部字体/图片/CDN 资源(整页自包含内联)。
