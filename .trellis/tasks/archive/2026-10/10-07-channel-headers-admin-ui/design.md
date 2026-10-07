# Design:渠道自定义请求头 + 后台 UI 重构

> 对应 prd.md R1/R2/R3。技术设计:边界、契约、数据流、取舍、兼容与回滚。

## 1. 数据层(R1/R2)

### 1.1 migration `0003_channel_extra_headers.sql`

```sql
ALTER TABLE sources ADD COLUMN extra_headers TEXT;
```

- 可空 TEXT,存 JSON 对象字符串(如 `{"x-api-key":"sk-..."}`),空/NULL = 无自定义头。
- 新增列对 `SELECT *` 透明带出,`SourceRow` 加 `extra_headers: string | null`;**cron 轮询路径零新语句、零新 subrequest**。
- 禁止改 0001/0002(database-guidelines Migrations)。

### 1.2 `src/db/sources.ts` 变更

- `SourceRow` 加 `extra_headers: string | null`。
- `createChannelSource` 入参加 `extra_headers?: string | null`(JSON 字符串由调用方构造,db 层只存)。
- 新增 `updateChannelSource(db, id, patch, nowIso)`:`{ name?; base_url?; api_key?: string | null; extra_headers?: string | null }`,动态拼 SET(仿 `updateSourceStatus`,api_key/extra_headers 用 `'key' in patch` 区分"清空"与"不修改"),1 条 UPDATE + updated_at 必写。**仅 UPDATE,不在此函数内判断 kind**(路由层守卫)。

### 1.3 头解析/校验纯函数 — 新建 `src/lib/headers.ts`

engine 与 admin routes 共用,两个入口:

```ts
/** 存量容错读:JSON.parse 失败/非平面对象/含非法项 → 返回 {},绝不抛 */
parseStoredHeaders(json: string | null | undefined): Record<string, string>

/** 输入校验(admin 写路径):返回归一化对象或 null(=400) */
sanitizeHeaderMap(input: unknown): Record<string, string> | null
```

校验规则(两端一致):
- input 必须是 plain object(非数组/非 null),**空对象合法**(=清空)。
- 键:trim 后非空、≤128 字符、不得含 `:` 与 CR/LF 及其他 C0 控制字符;重复键(仅大小写差异)视为冲突 → 非法(fetch Headers 大小写不敏感,避免歧义)。
- 值:string、≤1024 字符、不得含 CR/LF(CRLF 注入防护);trim。
- 数量 ≤16。
- `parseStoredHeaders` 按同规则逐项过滤(存量中历史坏项静默丢弃),整体坏 → `{}`。

## 2. 轮询引擎(R1)

`src/poll/engine.ts::fetchBody` 现有两行 headers 构造改为:

```ts
const headers: Record<string, string> = { accept: 'application/json' };
if (src.api_key) headers.authorization = `Bearer ${src.api_key}`;
Object.assign(headers, parseStoredHeaders(src.extra_headers)); // 自定义头最后合并,可覆盖上两者
```

- 合并顺序 = 优先级:`accept`(内置) < `authorization`(api_key 派生) < 自定义头(用户显式配置,支持 `x-api-key`、`Authorization: Basic` 等覆盖用法)。
- 把这三行提为导出纯函数 `buildFetchHeaders(src: Pick<SourceRow,'api_key'|'extra_headers'>): Record<string,string>`,`fetchBody` 调用它——单测不必 stub fetch。
- 预算:不新增语句/subrequest;改头导致响应变化 → hash 变化 → 正常 diff 一轮(一次性,符合既有语义)。

## 3. admin API(R1/R2)

### 3.1 `POST /admin/api/sources`(扩展)

- body 新增可选 `extra_headers`(对象);经 `sanitizeHeaderMap` 校验,null → 400 `自定义请求头格式非法`。
- `createChannelSource` 传入 `JSON.stringify(sanitized)`(空对象存 `'{}'`)。

### 3.2 `PATCH /admin/api/sources/:id`(扩展为完整编辑)

body 语义(向后兼容,`enabled` 行为不变):

| 字段 | 类型 | 语义 |
|---|---|---|
| `enabled` | boolean | 启停(现状不变) |
| `name` | string | trim 后非空 ≤64,更新名称 |
| `base_url` | string | `^https?://` ≤512,更新端点 |
| `api_key` | string / null | 非空 = 更新;`null` = 清空;undefined/空串 = 不修改 |
| `extra_headers` | object / null | 对象 = 整体替换(sanitize 后);`null` = 清空;undefined = 不修改 |

流程:
1. `getSource` 读旧值(1 D1)。
2. `kind !== 'channel'` 且 body 含编辑字段 → 400(目录源只接受 `enabled`)。
3. `base_url` 实际变更 → 更新后追加 `resetSourceModels`(静默重接入:清存量 + seed_done=0 + last_hash=NULL,下轮一条 seed 确认;events 审计保留)。
4. 汇总成 1 条 `updateChannelSource` UPDATE(+可选 reset 的 2 条 batch)→ 单请求 ≤4 条 D1。
5. `api_key` 本体永不回显;`extra_headers` 明文回显(用户决策)。

### 3.3 `GET /admin/api/state`(扩展)

sources 每项新增:
- `extra_headers: parseStoredHeaders(s.extra_headers)`(完整键值回显,编辑表单预填)
- `has_extra_headers: boolean`(轻量标记,渲染表格用)

## 4. 后台 UI(R3)

### 4.1 文件重组:`src/admin/ui.ts` → `src/admin/ui/`

| 文件 | 职责 |
|---|---|
| `css.ts` | `BASE_CSS`(重构后的 CSS 变量体系 + tabs + 动画 + 响应式) |
| `page.ts` | `page()` 骨架 + 防 FOUC 主题内联脚本 + 主题切换/标签页共享 JS 工具 |
| `setup.ts` / `login.ts` | 现有两个页面 render,结构不动,吃到新样式 |
| `admin.ts` | admin 单页(五 tab 骨架 + 渠道编辑 dialog + 内联 JS) |
| `index.ts` | re-export 三个 render*,routes.ts 改 import 即可 |

### 4.2 标签页

- 五组:`overview`(操作/Feed)、`sources`(源管理+添加+编辑)、`notify`(通知与监控设置)、`events`(最近事件)、`security`(改密码)。
- 结构:header 下 `<nav class="tabs" role="tablist">`(button role=tab,aria-selected)+ `<section role="tabpanel" hidden>`。
- 切换:JS click → 切 `hidden` + `aria-selected` + `.active`;`history.replaceState(null,'','#tab-'+id)` 写 hash(不污染后退栈),load 时读 `location.hash` 恢复,默认 `overview`;hash 无效回落 overview。
- 面板进入动画:面板解除 hidden 后加 `.enter` class 触发 `@keyframes panelIn`(opacity 0→1 + translateY 6px→0,180ms ease-out);animationend 后移除 class(可重复触发)。

### 4.3 主题(CSS 变量 + 三态)

- `:root` 定义语义变量:`--bg --fg --muted --card --border --input-bg --input-border --accent --accent-strong --danger --out-bg --out-fg --tag-added --tag-delisted --tag-seed --tag-fail --tag-recovered --code-bg` 等,默认亮色值;`color-scheme` 跟随 data-theme。
- 层级:`@media (prefers-color-scheme: dark){ html:not([data-theme]) { …暗色 } }`(auto 态);`html[data-theme="light"]{…亮色}`;`html[data-theme="dark"]{…暗色}`。`.out`/`.tag`/`code` 全部改用变量。
- 持久化:`localStorage 'mm_theme'`,取值 `auto|light|dark`,非法值视为 auto。
- **防 FOUC**:`page()` 在 `<style>` 之后、`<body>` 之前注入同步小脚本:读 localStorage → 非空则 `document.documentElement.dataset.theme=值`(渲染前生效,无闪白)。
- 切换控件:header 上一个按钮循环 `auto → light → dark`,图标 `🌗/☀️/🌙` + aria-label;auto 态不设 data-theme(交还系统)。
- 主题切换过渡:`body, .card, input, select, textarea, button, fieldset, .out { transition: background-color .2s, color .2s, border-color .2s }`。

### 4.4 动画清单(全部 CSS,克制)

- tab 面板 `panelIn`(见 4.2)。
- 按钮/输入控件:`transition: background-color/border-color/box-shadow .15s`;button `:hover` 背景变化、`:active { transform: scale(.98) }`;primary hover 轻微加深。
- tab 下划线指示条:`::after` transform scaleX 0→1,.2s。
- 编辑 `<dialog>`:`dialog[open]{ animation: dialogIn .18s ease-out }`(scale .96→1 + fade);`::backdrop` 半透明跟随主题。
- `@media (prefers-reduced-motion: reduce)`:动画/过渡时长归零(保留 opacity 瞬变),无位移。

### 4.5 响应式

- 断点 `@media (max-width: 719.5px)`:
  - `.tabs` 横滚:`overflow-x:auto; scrollbar-width: none;` tab 不换行(`white-space:nowrap`),首尾 scroll-padding。
  - `.row` 变单列(`flex-direction:column`,子项 `min-width:0`);`fieldset` padding 收窄;`header` 允许换行。
  - 表格保留现有 `.tblwrap` 横滚(不卡片化,改动面小且可预期)。
- `viewport` meta 已有;375px 基准验收。

### 4.6 渠道编辑交互

- 源表格渠道行加「编辑」按钮 → 打开 `<dialog id="editDlg">`(一个 dialog 复用,填充当前行数据):
  - 名称/端点 URL 文本框(预填);API Key password 框(placeholder 显示"已配置,留空 = 不修改"或"未配置");「清空 API Key」checkbox(勾选才提交 null)。
  - 自定义请求头 `<textarea>`:**`Header-Name: value` 行式格式**(每行一条,`#` 开头行忽略),预填时由对象反向生成;帮助文案给出 `x-api-key: sk-...` 示例。
  - 客户端解析:按行 split,首个 `:` 前为名后为值,trim;空行/注释跳过;格式错行 → 前端即时报错不发请求。
  - 提交 `PATCH`:组装 `{name, base_url, api_key?, extra_headers}`;「清空请求头」checkbox → `extra_headers: null`。
- 添加渠道表单同样加请求头 textarea(可折叠 `<details>`,默认收起,降低主表单噪音)。
- 渲染纪律不变:预填一律走 DOM API 赋值(`.value`),不经 innerHTML。

### 4.7 客户端 JS 约束

- 继续禁用反引号与 `${`(TS 模板字面量冲突);字符串一律单引号拼接。
- 主题脚本中同样遵守;`localStorage` 访问包 try-catch(隐私模式抛异常时不阻塞渲染)。

## 5. 测试设计

| 文件 | 用例 |
|---|---|
| `test/headers.test.ts`(新) | `parseStoredHeaders`:null/空串/坏 JSON/非对象/含 CRLF 项被滤/大小写重复被滤/正常对象;`sanitizeHeaderMap`:数组/null → null、键含 `:` 或 CR/LF → null、超 16 个 → null、超长键值 → null、大小写重复 → null、空对象 → `{}`、值 trim |
| `test/engine-headers.test.ts`(新) | `buildFetchHeaders`:无 key 无头 → 仅 accept;有 key → Bearer;头覆盖 accept/authorization;头与 key 共存 |
| `test/update-source.test.ts`(新) | 内存 D1 stub(仅实现 prepare/bind/run 记录 SQL+参数):`updateChannelSource` 各 patch 组合的 SET 子句与绑定值;`'api_key' in patch` 清空语义 |
| `test/ui.test.ts`(新,轻量) | `renderAdminPage()` 输出含五 tabpanel 骨架、主题防 FOUC 脚本、`prefers-reduced-motion`;`renderLoginPage/SetupPage` 含主题脚本(字符串断言,不引 DOM 测试库) |

D1 stub 放 `test/helpers/d1.ts`(新建,首例,后续可复用)。

## 6. 契约同步(与代码同批)

- `product/data-sources.md`:渠道源行的鉴权列改为"可选 Bearer key + 任意自定义请求头(覆盖内置,支持非 Bearer 鉴权)",备注编辑/静默重接入语义。
- `product/admin-and-feed.md`:后台路由描述补"渠道源编辑(名称/URL/API Key/自定义头;改 URL 静默重接入)"。
- `product/index.md` 契约地图无需新文件(并入现有两文件)。

## 7. 取舍记录

- **行式 `Name: value` textarea 而非 JSON/键值对网格**:对 curl/HTTP 心智的用户最自然,实现最薄,移动端可用;JSON 语法错误对普通用户不友好。
- **`<dialog>` 而非行内展开编辑**:表格保持紧凑,dialog 原生带焦点圈定与 Esc,移动端自动全宽,零依赖。
- **改 URL → 静默重接入 而非 自然 diff**:新旧端点模型集通常无关联,diff 只会产生全量 added/delisted 噪音通知;静默重接入复用既有 reset 语义,一条 seed 确认。
- **api_key 维持不回显而 extra_headers 回显**:用户明确选择;头值回显换来编辑可用性,自用 + 已鉴权背景下风险可接受。
- **extra_headers 整体替换而非增量 patch**:键值对无序、无稳定 id,整体替换语义最简单,UI 本来就是全量预填。
- **主题三态而非双态**:跟随系统是桌面暗色用户的默认预期,强制二选一会丢这个体验。
- **UI 重组仅拆文件不改 render 签名**:routes.ts 只改一行 import,回归面最小。

## 8. 兼容与回滚

- 兼容:新列可空,旧行 extra_headers=NULL → parse 为 {} → 行为与现在完全一致;PATCH 旧客户端只传 `{enabled}` 照常工作;state 响应为增量字段,前端同批升级无版本交错问题(单 Worker 整体部署)。
- 回滚:代码回滚后新列留存无害(不参与任何查询语义);migration 不需要 down(D1 无 down 惯例,可空列零影响)。
- 部署:push main → CI 自动 `d1 migrations apply --remote`(既有检测逻辑,0003 会被自动应用)。
