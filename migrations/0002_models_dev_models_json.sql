-- models.dev 目录源端点切换:/api.json → /models.json(spec:product/data-sources.md)
-- /models.json 是扁平 {lab/model → 富字段} 字典(实验室级口径,~409KB,对比 /api.json ~5.3MB),
-- 聚合渠道面不再进入该源;normalize 对两种字典结构均兼容。
-- rebaseline=1:下轮探测忽略 last_hash,按新口径静默全量重建(零事件零通知,复用 engine 4b 路径)。
UPDATE sources
SET base_url = 'https://models.dev/models.json',
    rebaseline = 1,
    updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
WHERE kind = 'catalog' AND name = 'models.dev';
