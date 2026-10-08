/**
 * 主页聚合数字(spec:product/admin-and-feed.md「公开主页」):单条 SQL 子查询合并三个数,
 * 缓存未命中的主页访问 D1 语句数恒为 1(免费档 subrequest 预算;Cache API 命中为 0)。
 * 只暴露聚合值——源名/端点/模型 ID/事件内容一律不出 db 层。
 */
export interface HomeStats {
  sourceCount: number;
  modelCount: number;
  recentEvents: number;
}

export async function getHomeStats(db: D1Database): Promise<HomeStats> {
  // 近 24h:cutoff 与 detected_at 同为 UTC ISO 字符串,字典序比较等价时间比较(>= 含边界时刻)
  const cutoff = new Date(Date.now() - 86_400_000).toISOString();
  const row = await db
    .prepare(
      `SELECT
        (SELECT COUNT(*) FROM sources WHERE enabled = 1) AS source_count,
        (SELECT COUNT(*) FROM models WHERE missing = 0) AS model_count,
        (SELECT COUNT(*) FROM events WHERE kind IN ('added','delisted') AND detected_at >= ?) AS recent_events`,
    )
    .bind(cutoff)
    .first<{ source_count: number; model_count: number; recent_events: number }>();
  // 未初始化/空表:COUNT 子查询天然回 0;first 无行(防御)也归 0,不抛错
  return {
    sourceCount: row?.source_count ?? 0,
    modelCount: row?.model_count ?? 0,
    recentEvents: row?.recent_events ?? 0,
  };
}
