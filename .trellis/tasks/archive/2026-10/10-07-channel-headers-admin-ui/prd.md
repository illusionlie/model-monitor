# PRD:渠道自定义请求头 + 后台 UI 重构

> 任务:10-07-channel-headers-admin-ui · 单任务(用户已确认)
> 用户决策(2026-10-07):单任务 / 渠道做**完整编辑**(名称/URL/API Key/请求头) / 自定义头值**回传**(api_key 维持原有"永不回传"纪律)

## 背景

- 渠道源目前仅支持可选 Bearer key(`sources.api_key`),无法满足非 Bearer 鉴权的渠道(如 `x-api-key`、`api-key`、`Authorization: Basic` 等)。
- 渠道创建后**不可编辑**(只能启停/清理/删除),配置错误须删除重建。
- 后台单页 5 个区块纵向堆叠在一页,需要上下滚动;无标签页/动画/暗色模式/真正的响应式断点。

## 需求

### R1 渠道自定义请求头

- 每个渠道源可配置一组自定义 HTTP 请求头,轮询 fetch 时随请求发送。
- 头的优先级**高于**内置头:可覆盖默认 `accept: application/json` 与 `api_key` 生成的 `authorization: Bearer`(显式配置意图优先,这是非 Bearer 鉴权渠道的主要用例)。
- 创建渠道时可直接填写;已有渠道通过编辑(R2)后补/修改/清空。

### R2 渠道完整编辑

- 渠道(仅 `kind='channel'`)支持编辑:名称 / Models 端点 URL / API Key / 自定义请求头。
- API Key 与请求头均可**清空**;API Key 留空提交 = 不修改(与现有 settings 机密纪律一致)。
- 端点 URL 实际变更时,该源按"静默重接入"处理(清空存量模型、下轮 seed,仅一条接入确认),避免新旧端点模型集 diff 出大量噪音事件。
- 内置目录源(OpenRouter / models.dev)不可编辑这些字段,仅维持启停。

### R3 后台 UI 重构

- **分组标签页**:把单页纵向堆叠改为标签页分组,消灭"全页滚动找配置"。分组:概览(操作/Feed)、源管理、通知设置、事件、安全(改密码)。
- **过渡动画**:标签页切换、按钮/控件 hover 与 active、对话框进出、主题切换的颜色过渡;尊重 `prefers-reduced-motion`。
- **响应式**:明确移动端断点;标签栏窄屏横滚;表单窄屏单列;移动端(≥375px)全功能可用。
- **亮暗色切换**:三态(跟随系统/亮/暗),选择持久化(localStorage),未选择时跟随 `prefers-color-scheme`;无闪烁(FOUC 防护);登录/初始化页同步生效。

## 约束

- 免费档纪律不破:新增能力不得增加 cron 轮询路径的 subrequest/D1 语句数(编辑接口仅影响 admin API 单次请求,≤4 条 D1 语句)。
- 无前端构建链、无新依赖:继续服务端拼 HTML + 内联 CSS/JS + vanilla JS;客户端脚本内禁用反引号与 `${`。
- 远端数据仍一律 `textContent` 渲染防注入;SQL 全参数化;admin API 全部过鉴权中间件。
- 产品契约同步:本批改动更新 `product/data-sources.md`(渠道源鉴权)与 `product/admin-and-feed.md`(后台能力),与代码同批提交。
- `non-goals.md` 不涉及(自定义头/编辑/主题均不在禁止列表)。

## 验收标准

1. `npm run typecheck` 0 错误;`npm test` 全绿(含新增用例)。
2. migration `0003` 新增列,本地 `wrangler d1 migrations apply --local` 可重复应用;已部署库无破坏(新增可空列,旧行为不变)。
3. 配置了自定义头的渠道,轮询请求携带这些头,且可覆盖 `authorization`(单测覆盖合并顺序与非法输入容错)。
4. 渠道编辑四字段生效:改名即时可见;改 URL 触发静默重接入(存量清空、下轮一条 seed 确认);API Key 可改可清;请求头可增删清。
5. `GET /admin/api/state` 回传渠道 `extra_headers` 完整键值;`api_key` 仍只回 `has_api_key`。
6. 后台:五标签页切换正常且刷新/直达后停留当前页(hash);移动端 375px 宽全功能可用;亮暗切换持久化且无闪白;系统暗色时默认暗;`prefers-reduced-motion: reduce` 下无位移动画。
7. 登录页与初始化页共享主题与基础样式,无布局回归。
