# 执行计划

顺序执行,每步可独立 revert;迁移前滚由 CI 承担。

1. [ ] `src/poll/normalize.ts`:字典适配扩展(扁平 lab/model 分支、函数更名、头注释)
2. [ ] `test/normalize.test.ts`:新增扁平字典 describe(含混合结构与边界)
3. [ ] 验证门 1:`npm run typecheck && npm test`
4. [ ] `migrations/0002_models_dev_models_json.sql`(UPDATE base_url + rebaseline=1)
5. [ ] `src/db/sources.ts`:`resetSourceModels`(batch 2 语句,不限 kind)
6. [ ] `src/admin/routes.ts`:`POST /admin/api/sources/:id/reset`(400/404 分支,无 kind 限制)
7. [ ] `src/admin/ui.ts`:源行"清理模型"按钮(渠道与目录)+ confirm + 刷新
8. [ ] 验证门 2(全量):`npm run typecheck && npm test`
9. [ ] spec 同步:`.trellis/spec/product/data-sources.md`(端点行 + 语义注记)、`external-facts.md`(models.dev 行:200 / ~409KB / 扁平字典;核实日期 2026-10-07)
10. [ ] (可选,本地具备 wrangler.toml 时)`npx wrangler d1 migrations apply model-monitor-db --local` + `npm run dev` 手测两条链路

## 验证命令

- `npm run typecheck`(0 错误)
- `npm test`(全绿,含新增用例)

## 回滚点

- 代码步直接 revert 对应文件。
- 迁移已应用需回退时:追加 0003 反向迁移,不得改写 0002。

## 评审重点

- normalize 分派规则:键含 '/' 且值无 `.models` 才算扁平条目;provider 名不含 '/',不会把 `/api.json` 的 provider 条目误判为模型。
- `resetSourceModels` 只动 models 行与 sources 的 seed 状态字段;不触 events、不动源配置字段。
- UI 内联脚本不使用反引号与 `${`。
