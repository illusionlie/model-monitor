# Implement:渠道自定义请求头 + 后台 UI 重构

> 前置:prd.md / design.md 已定稿。按步序执行;每步末跑验证命令,绿了才进下一步。

## Step 1:数据层 + 纯函数(无行为变化)

- [ ] `migrations/0003_channel_extra_headers.sql`:`ALTER TABLE sources ADD COLUMN extra_headers TEXT;`(带注释头,风格仿 0002)
- [ ] `src/db/sources.ts`:`SourceRow` 加 `extra_headers: string | null`;`createChannelSource` 入参加 `extra_headers?: string | null` 并入 INSERT;新增 `updateChannelSource`(动态 SET,`'api_key' in patch` / `'extra_headers' in patch` 区分清空与不修改,updated_at 必写)
- [ ] 新建 `src/lib/headers.ts`:`parseStoredHeaders` + `sanitizeHeaderMap`(规则见 design §1.3,≤16 个、名 ≤128 值 ≤1024、禁 CR/LF、键禁 `:`、大小写重复冲突)
- [ ] 新建 `test/headers.test.ts`、`test/update-source.test.ts`(D1 stub 放 `test/helpers/d1.ts`:实现 prepare/bind/run 记录 SQL 与参数即可)
- [ ] 验证:`npm run typecheck && npm test`
- [ ] 本地迁移自测:`npx wrangler d1 migrations apply model-monitor-db --local`(应显示 0003 待应用并成功)

## Step 2:引擎合并 + admin API

- [ ] `src/poll/engine.ts`:提取导出 `buildFetchHeaders(src)`(accept → Bearer → parseStoredHeaders 合并),`fetchBody` 改为调用它;确认 runOnce 语句数不变
- [ ] `src/admin/routes.ts`:
  - `POST /admin/api/sources`:接受可选 `extra_headers` 对象,`sanitizeHeaderMap` 校验(null → 400),存 `JSON.stringify`
  - `PATCH /admin/api/sources/:id`:按 design §3.2 语义扩展(enabled 兼容;channel-only 编辑守卫;base_url 实变 → `resetSourceModels`)
  - `GET /admin/api/state`:sources 项加 `extra_headers`(parseStoredHeaders 后回显)与 `has_extra_headers`
- [ ] 新建 `test/engine-headers.test.ts`
- [ ] 验证:`npm run typecheck && npm test`

## Step 3:后台 UI 重构

- [ ] `src/admin/ui.ts` → `src/admin/ui/` 目录拆分(design §4.1),`index.ts` re-export,routes.ts 改 import
- [ ] `css.ts`:CSS 变量体系(亮/暗两套值)、tabs、panelIn/dialogIn 动画、按钮过渡、720px 断点响应式、prefers-reduced-motion、`.out`/`.tag`/`code` 变量化
- [ ] `page.ts`:`page()` 注入防 FOUC 主题脚本(读 localStorage 'mm_theme',try-catch);主题三态切换工具(auto/light/dark 循环)
- [ ] `admin.ts`:
  - 五 tab 骨架(overview/sources/notify/events/security)+ hash 持久(replaceState + load 恢复,无效回落 overview)
  - header 加主题切换按钮(🌗/☀️/🌙)
  - 渠道行「编辑」按钮 + `<dialog id="editDlg">`:名称/URL/API Key(留空不改 + 清空 checkbox)/请求头 textarea(`Name: value` 行式,预填反向生成,客户端逐行解析报错)
  - 添加表单加可折叠请求头 textarea(`<details>`)
  - 全部客户端 JS:单引号拼接,禁反引号与 `${`;预填走 `.value`,渲染走 DOM API
- [ ] `setup.ts`/`login.ts`:吃到主题与基础样式(无 tabs),行为不变
- [ ] 新建 `test/ui.test.ts`(字符串断言:五 tabpanel、防 FOUC 脚本、reduced-motion、dialog 元素存在)
- [ ] 验证:`npm run typecheck && npm test`

## Step 4:手测(本地)

- [ ] `npm run dev` 后浏览器走查:五 tab 切换 + 刷新停留;375px(devtools)横滚 tab、表单单列;亮暗切换持久化、无 FOUC、跟随系统;登录/setup 页样式正常
- [ ] 添加带头的渠道 → `state` 可见 → 编辑改名/清空 key/改头;改 URL 后观察 reset 语义(模型清空,下轮 seed)
- [ ] reduced-motion 模拟(DevTools rendering)下无位移动画

## Step 5:契约同步

- [ ] `product/data-sources.md`:渠道源鉴权列 + 自定义头语义(design §6)
- [ ] `product/admin-and-feed.md`:后台路由补渠道编辑能力
- [ ] 复核 `product/non-goals.md` 无需变更

## Step 6:全量检查(review gate)

- [ ] `npm run typecheck && npm test` 全绿
- [ ] trellis-check 全范围审查(quality-guidelines checklist:契约一致性 / subrequest 预算 / secrets / 鉴权 / HTML 转义)
- [ ] 用户过目后台截图或本地走查

## 回滚点

- Step 1-2 各自独立可回滚(git revert 对应提交;0003 列留存无害)
- Step 3 UI 与 API 无交错依赖(API 字段向后增量),可单独 revert

## 提交

- 按 workflow Phase 3.4:工作提交(代码+测试+契约)在前,bookkeeping(任务归档)在后;不 push
