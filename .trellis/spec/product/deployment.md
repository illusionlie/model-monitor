# 部署(对齐用户既有惯例;参考仓库根 deploy.yml、deploy2.yml)

> 原 `DECISIONS.md` §7(2026-10-07 迁入),措辞保持设计定稿原文。

- 仓库只留 `wrangler.toml.example`(占位符 `__WORKER_NAME__`、`__D1_DATABASE_ID__`、`__CRON_EXPRESSION__` 等);wrangler.toml 不入库。
- GitHub Actions(私库):push + workflow_dispatch 触发;按 name 查找 D1、不存在则自动创建(支持 `CF_D1_DATABASE_ID` secret 指定既有库并校验存在);检测"是否初始化 / migrations 目录是否变更"决定是否 `wrangler d1 migrations apply --remote`(workflow 输入可手动强制);sed 从 example 生成 wrangler.toml;可选 `CUSTOM_DOMAIN` secret 追加 routes;`wrangler deploy`。
- GH secrets 只放部署凭据(CF_API_TOKEN、可选 CF_ACCOUNT_ID、WORKER_NAME 等);业务密钥不经 CI。
