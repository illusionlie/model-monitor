-- 渠道源自定义请求头(spec:product/data-sources.md):可空 TEXT,存 JSON 对象字符串(如 {"x-api-key":"sk-..."}),
-- 空/NULL = 无自定义头;轮询 fetch 时最后合并,可覆盖内置 accept 与 Bearer authorization(支持非 Bearer 鉴权渠道)。
-- 仅渠道源使用(创建/编辑时写入);新增可空列对既有行为透明,cron 轮询路径零新语句。
ALTER TABLE sources ADD COLUMN extra_headers TEXT;
