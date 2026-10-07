# 技术设计

## 总体

两个交付物相互独立。均不动 diff 状态机、engine 主流程与通知渲染——A 复用既有 rebaseline 路径,B 复用既有 seed 路径,新逻辑集中在迁移、normalize 字典分支、一个 db 函数、一条路由、一个按钮。

## A. models.dev → /models.json

### 数据迁移 `migrations/0002_models_dev_models_json.sql`

```sql
UPDATE sources
SET base_url = 'https://models.dev/models.json',
    rebaseline = 1,
    updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
WHERE kind = 'catalog' AND name = 'models.dev';
```

- `WHERE kind + name` 双条件精确命中内置 models.dev 源;`strftime` 与 0001 种子写法一致(秒级 UTC ISO)。
- `rebaseline=1` 借用 engine 既有 4b 路径(`src/poll/engine.ts:257`):下轮忽略 `last_hash` 强制重解析,按新口径静默全量重建(live∩DB 保留、DB 多余静默删、live 新增静默插),零事件零通知,写回新 hash、复位 rebaseline。
- 部署:CI `deploy.yml` 的 Apply D1 migrations 步骤检测到待应用迁移自动执行(`--remote`);本地验证需 `--local` 手动应用。
- 兼容性:models.dev 已有 `seed_done=1`,不会触发 seed;catalog 组去重历史里的旧 model_id 多为 lab/model 形态(`/api.json` 下聚合渠道的 slug 本就带 lab 前缀),去重语义不受损、反而命中率上升。
- 回滚:追加 0003 反向 UPDATE(改回 `/api.json` + `rebaseline=1`)即可,normalize 对旧结构保持兼容,不改写已应用的 0002。

### normalize `src/poll/normalize.ts`

字典式适配从"仅二层结构"扩展为按条目分派:

- 值为 record 且含 record `.models` → `/api.json` 二层:沿用现逻辑(无前缀 slug 补 `{provider}/`)。
- 键含 `/` 且值为 record(无 `.models`)→ `/models.json` 扁平:id=键;provider=首个 `/` 的前缀;snapshot=`pickSnapshot(['name','release_date'])`。
- 键不含 `/` 的条目跳过(provider 名不含 `/`,天然与二层字典的 provider 键区分,不会误判);非 record 值跳过;整体 0 条目沿用既有"解析失败"防线。
- `normalizeProviderDict` 更名(如 `normalizeDictCatalog`)并同步模块头注释。

决策依据:

- "目录源结构自适配"是 data-sources 契约,不裁掉旧分支;两分支合计 ~20 行。
- snapshot 键维持 `['name','release_date']`:`src/notify/render.ts` 仅消费这两个字段。
- 实测(2026-10-07):`/models.json` 200、~409KB、顶层扁平 `lab/model` 字典。

### 语义效果

models.dev 的 model_id 变为 lab/model,与 OpenRouter id 前缀同构,目录组跨源去重命中率上升;聚合渠道面(openrouter 等 provider 条目)不再进入 models.dev 源。

## B. 存量模型清理

### DB `src/db/sources.ts`

新函数 `resetSourceModels(db, id, nowIso)`:

- `db.batch` 两条语句:
  1. `DELETE FROM models WHERE source_id = ?`
  2. `UPDATE sources SET seed_done = 0, last_hash = NULL, rebaseline = 0, updated_at = ? WHERE id = ?`
- 归在 `sources.ts`:与 `createChannelSource` / `deleteChannelSource` 同属"源生命周期"操作;后者本就依赖 FK CASCADE 隐式清 models。
- 渠道与目录源一律可清:清 models 行是非破坏性的(源配置不动、events 审计不动、目录组去重历史在 events 表不受影响),下轮按 seed 路径静默重接入;"内置目录源不可删除"保护的是源本身,与清理无关。

### 路由 `src/admin/routes.ts`

`POST /admin/api/sources/:id/reset`(挂 requireAuth 之后,与 PATCH/DELETE 并列):

- id 非法 → 400;`getSource` 为空 → 404。不做 kind 区分,渠道与目录源均可清理。
- 成功返回 `{ok:true}`。

### UI `src/admin/ui.ts`

- `renderSources` 每行操作列加"清理模型"按钮(渠道行排在"删除"前;目录行与启停并列)。
- confirm 文案:`清理「name」的已存模型?下轮探测将按新源静默重新接入(仅一条确认通知)。`
- `api()` POST 后 `loadState()` 刷新(model_count 归零、seed 状态复位可见)。

### 语句预算(admin 调用)

1 fetch + getSource 1 读 + batch 2 语句 = 4 subrequest/次,远低于 50。

## 测试

- `test/normalize.test.ts` 新增 describe:扁平字典(正常解析 / provider / snapshot;无 '/' 键跳过;非 record 值跳过;与二层字典混合共存)。
- db / routes 层无测试设施(仓库现状:该两层零测试),reset 行为靠类型约束 + 本地 `npm run dev` 手测(添加渠道 → 运行 → 清理 → 再运行,观察 seeded 与 model_count)。
- 既有全部用例作为回归防线。
