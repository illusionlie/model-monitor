import { describe, expect, it } from 'vitest';
import { renderHomePage } from '../src/admin/ui';
import { getHomeStats } from '../src/db/stats';
import { D1Stub, type ExecutedStatement } from './helpers/d1';

/** 提取 HTML 里全部 <script> 内联段(ui.test.ts 同款) */
function scriptsOf(html: string): string[] {
  return html
    .split('<script>')
    .slice(1)
    .map((s) => s.slice(0, s.indexOf('</script>')));
}

describe('renderHomePage:公开主页纯渲染(任务 10-08-public-homepage)', () => {
  const html = renderHomePage({ sourceCount: 3, modelCount: 128, recentEvents: 7 });

  it('品牌区:服务名 + 一句话定位 + 三个状态数字', () => {
    expect(html).toContain('<h1>model-monitor</h1>');
    expect(html).toContain('定时轮询 LLM 模型目录与渠道端点');
    expect(html).toContain('<strong>3</strong>');
    expect(html).toContain('<strong>128</strong>');
    expect(html).toContain('<strong>7</strong>');
    // 数字槽位恰 3 个且均为纯数字(聚合值之外无其他注入点)
    expect(html.match(/<strong>\d+<\/strong>/g)).toHaveLength(3);
  });

  it('入口:进入后台 → /admin;GitHub 仓库链接;免费档页脚', () => {
    expect(html).toContain('href="/admin"');
    expect(html).toContain('进入后台');
    expect(html).toContain('href="https://github.com/illusionlie/model-monitor"');
    expect(html).toContain('跑在 Cloudflare Workers 免费档');
  });

  it('复用 page() 骨架与 BASE_CSS 三态主题(与后台页共享)', () => {
    expect(html).toContain('<!doctype html>');
    expect(html).toContain("localStorage.getItem('mm_theme')");
    expect(html).toContain('prefers-color-scheme: dark');
    expect(html).toContain('html[data-theme="dark"]');
  });

  it('信息暴露边界:不含源名/端点/模型 ID/事件内容/机密字段(PRD 硬约束)', () => {
    for (const secret of [
      'OpenRouter',
      'models.dev',
      'base_url',
      'api_key',
      'source_name',
      'model_id',
      'payload',
      'tg_bot_token',
      'resend_api_key',
    ]) {
      expect(html).not.toContain(secret);
    }
  });

  it('无页面脚本;共享主题脚本内无反引号与模板插值', () => {
    const scripts = scriptsOf(html);
    expect(scripts).toHaveLength(1); // 仅 page() 内的防 FOUC 主题脚本
    for (const s of scripts) {
      expect(s).not.toContain('`');
      expect(s).not.toContain('${');
    }
  });
});

/** D1Stub 变体:first() 返回预设行(主页聚合查询走 first),语句照常记入 executed */
const STUB_META: D1Meta = {
  duration: 0,
  size_after: 0,
  rows_read: 0,
  rows_written: 0,
  last_row_id: 0,
  changed_db: false,
  changes: 0,
};

class RowStatement implements D1PreparedStatement {
  private params: unknown[] = [];
  constructor(
    private readonly sink: ExecutedStatement[],
    readonly sql: string,
    private readonly row: Record<string, number>,
  ) {}
  bind(...values: unknown[]): D1PreparedStatement {
    this.params = values;
    return this;
  }
  private record(): void {
    this.sink.push({ sql: this.sql, params: this.params });
  }
  async first<T = Record<string, unknown>>(): Promise<T | null> {
    this.record();
    return this.row as unknown as T;
  }
  async all<T = Record<string, unknown>>(): Promise<D1Result<T>> {
    this.record();
    return { success: true, meta: { ...STUB_META }, results: [] };
  }
  async raw<T = unknown[]>(options: { columnNames: true }): Promise<[string[], ...T[]]>;
  async raw<T = unknown[]>(options?: { columnNames?: false }): Promise<T[]>;
  async raw<T = unknown[]>(options?: { columnNames?: boolean }): Promise<T[] | [string[], ...T[]]> {
    this.record();
    return [] as unknown as T[] | [string[], ...T[]];
  }
  async run<T = Record<string, unknown>>(): Promise<D1Result<T>> {
    this.record();
    return { success: true, meta: { ...STUB_META }, results: [] };
  }
}

class HomeStatsD1Stub extends D1Stub {
  constructor(private readonly row: Record<string, number>) {
    super();
  }
  prepare(query: string): D1PreparedStatement {
    if (query.includes('AS source_count')) return new RowStatement(this.executed, query, this.row);
    return super.prepare(query);
  }
}

describe('getHomeStats:单条 SQL 三子查询(缓存未命中 = 1 条 D1 语句)', () => {
  it('恰 1 条语句;三个标量子查询各带过滤', async () => {
    const db = new D1Stub();
    await getHomeStats(db);
    expect(db.executed).toHaveLength(1);
    expect(db.executed[0].sql).toContain('(SELECT COUNT(*) FROM sources WHERE enabled = 1)');
    expect(db.executed[0].sql).toContain('(SELECT COUNT(*) FROM models WHERE missing = 0)');
    expect(db.executed[0].sql).toContain("(SELECT COUNT(*) FROM events WHERE kind IN ('added','delisted') AND detected_at >= ?)");
  });

  it('kind 过滤:系统类事件(seed/source_fail/source_recovered/notify_fail)不在计数谓词内', async () => {
    const db = new D1Stub();
    await getHomeStats(db);
    const sql = db.executed[0].sql;
    for (const kind of ['seed', 'source_fail', 'source_recovered', 'notify_fail']) {
      expect(sql).not.toContain(`'${kind}'`);
    }
  });

  it('24h 边界:detected_at >= cutoff(UTC ISO 字典序,含边界时刻);cutoff = now - 24h', async () => {
    const before = Date.now();
    const db = new D1Stub();
    await getHomeStats(db);
    const after = Date.now();
    expect(db.executed[0].sql).toContain('detected_at >= ?'); // >= 而非 >:恰等于 cutoff 的事件计入
    expect(db.executed[0].params).toHaveLength(1);
    const cutoff = db.executed[0].params[0] as string;
    expect(cutoff).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/); // toISOString() 形态
    const t = Date.parse(cutoff);
    expect(t).toBeGreaterThanOrEqual(before - 86_400_000);
    expect(t).toBeLessThanOrEqual(after - 86_400_000);
  });

  it('未初始化/空表(first → null)→ 三个数字为 0,不抛错', async () => {
    const db = new D1Stub();
    await expect(getHomeStats(db)).resolves.toEqual({ sourceCount: 0, modelCount: 0, recentEvents: 0 });
  });

  it('行映射:source_count/model_count/recent_events → 三字段(数据版 stub)', async () => {
    const db = new HomeStatsD1Stub({ source_count: 2, model_count: 530, recent_events: 9 });
    await expect(getHomeStats(db)).resolves.toEqual({ sourceCount: 2, modelCount: 530, recentEvents: 9 });
    expect(db.executed).toHaveLength(1);
  });
});
