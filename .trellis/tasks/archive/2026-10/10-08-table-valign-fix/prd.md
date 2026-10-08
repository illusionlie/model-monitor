# 后台表格垂直居中修复(事件/渠道源表 wrap 列撑高行)

## Goal

后台表格中,换行撑高整行的场景下,其余单行内容列应在行内垂直居中,而非顶格贴上。

## 背景

后台基础样式 `src/admin/ui/css.ts:54` 的全局规则 `th,td{…;vertical-align:top;…}` 使所有单元格顶格对齐。事件表的「模型」列(`src/admin/ui/admin.ts:274`)与渠道源表的「最近错误」列(`admin.ts:240`)带 `wrap` 类(`white-space:normal`),内容换行后撑高整行,其余单行列(时间/源/类型/备注/操作按钮等)贴在行顶部。

## Requirements

- 事件表:模型列换行时,时间/源/类型/备注列垂直居中。
- 渠道源表:最近错误换行时,ID/名称/状态/模型数/最近成功/操作列垂直居中。
- 两处表格一致修复,改全局规则一处,不引入逐表局部样式。

## 方案(轻量,PRD-only)

`css.ts` 全局规则 `vertical-align:top` → `vertical-align:middle`。两表每行均只有一列 wrap(事件=模型,渠道源=最近错误),middle 使单行列垂直居中,wrap 列本身占满行高不受影响。后台无第三处数据表格使用 BASE_CSS。

## Acceptance Criteria

- [x] 事件表模型列换行时,其余列在行内垂直居中
- [x] 渠道源表最近错误列换行时,其余列在行内垂直居中
- [x] `npm run typecheck` 0 错误;`npm test` 通过
- [x] 亮/暗色主题无回归(纯对齐改动,不触颜色)

## Notes

- 非目标:不改列宽、padding、nowrap 策略;不做逐列对齐定制。
- spec 未记载该对齐方式,无需同步更新 spec。
