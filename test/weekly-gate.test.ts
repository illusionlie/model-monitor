import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../src/env';
import { beijingWeekStart, beijingWeekId, weeklyDue } from '../src/lib/time';
import { sendWeeklyReport } from '../src/notify/weekly';
import { D1Stub, type ExecutedStatement } from './helpers/d1';

/**
 * 2026-10-09 是本周(2026-W41,周一起 10-05)的周五。
 * 北京 21:00 = UTC 13:00。门控语义(spec:product/scheduling.md):每周五 21:00(Asia/Shanghai)后首个触发且本周未发。
 */

describe('周报门控 weeklyDue(design §8 / spec:product/scheduling.md)', () => {
  it('周五 20:59(北京)不触发', () => {
    expect(weeklyDue(new Date('2026-10-09T12:59:00Z'), undefined)).toBeNull();
    expect(weeklyDue(new Date('2026-10-09T12:59:59Z'), null)).toBeNull();
  });

  it('周五 21:00(北京)= UTC 13:00 边界,恰好触发', () => {
    const due = weeklyDue(new Date('2026-10-09T13:00:00Z'), undefined);
    expect(due).toBe('2026-W41');
  });

  it('周六补发(本周尚未发过)', () => {
    expect(weeklyDue(new Date('2026-10-10T02:00:00Z'), undefined)).toBe('2026-W41'); // 北京周六 10:00
    expect(weeklyDue(new Date('2026-10-11T15:30:00Z'), '')).toBe('2026-W41'); // 北京周日 23:30
  });

  it('本周已发过 → 不重发(跨周六/周日)', () => {
    expect(weeklyDue(new Date('2026-10-10T02:00:00Z'), '2026-W41')).toBeNull();
    expect(weeklyDue(new Date('2026-10-09T15:00:00Z'), '2026-W41')).toBeNull();
  });

  it('周五 21:00 前即使 lastSent 是别的周也不触发(只在门槛后发)', () => {
    expect(weeklyDue(new Date('2026-10-09T12:00:00Z'), '2026-W40')).toBeNull();
  });

  it('下周五 21:00 后进入新一周,旧标记不再压制', () => {
    expect(weeklyDue(new Date('2026-10-16T13:00:00Z'), '2026-W41')).toBe('2026-W42');
  });

  it('周内(周二/周四)不触发', () => {
    expect(weeklyDue(new Date('2026-10-06T12:00:00Z'), undefined)).toBeNull(); // 本周二
    expect(weeklyDue(new Date('2026-10-08T16:00:00Z'), undefined)).toBeNull(); // 本周四 北京周五 00:00
  });
});

describe('周标识与统计窗口(lib/time)', () => {
  it('beijingWeekId:ISO 周一为一周开始(北京 = UTC+8)', () => {
    expect(beijingWeekId(new Date('2026-10-05T00:30:00Z'))).toBe('2026-W41'); // 北京周一 08:30
    expect(beijingWeekId(new Date('2026-10-04T10:00:00Z'))).toBe('2026-W40'); // 北京周日 18:00,仍属上周
    expect(beijingWeekId(new Date('2026-10-04T20:00:00Z'))).toBe('2026-W41'); // 北京周一 04:00,跨入新周
  });

  it('beijingWeekStart:本周周一 00:00 北京 → 前一日 16:00 UTC', () => {
    const start = beijingWeekStart(new Date('2026-10-09T13:00:00Z'));
    expect(start.toISOString()).toBe('2026-10-04T16:00:00.000Z'); // 周一 2026-10-05 00:00 北京
    // 窗口起点必须早于门控时刻
    expect(start.getTime()).toBeLessThan(new Date('2026-10-09T13:00:00Z').getTime());
  });
});

describe('周报发送失败 → notify_fail 落库(任务 10-08-notify-fail-event:仅可见性记录;门控由 engine 写回,失败内容不自动重发)', () => {
  const FRI = new Date('2026-10-09T13:00:00.000Z'); // 北京周五 21:00 = 门控触发时刻

  /** D1Stub 变体:settings 全量读返回预设行,其余语句照常记入 executed(周报路径从 db 读 settings) */
  const STUB_META: D1Meta = {
    duration: 0,
    size_after: 0,
    rows_read: 0,
    rows_written: 0,
    last_row_id: 0,
    changed_db: false,
    changes: 0,
  };

  class SettingsStatement implements D1PreparedStatement {
    private params: unknown[] = [];
    constructor(
      private readonly sink: ExecutedStatement[],
      readonly sql: string,
      private readonly rows: { k: string; v: string }[],
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
      return null;
    }
    async all<T = Record<string, unknown>>(): Promise<D1Result<T>> {
      this.record();
      return { success: true, meta: { ...STUB_META }, results: this.rows as unknown as T[] };
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

  class SettingsD1Stub extends D1Stub {
    constructor(private readonly settingsRows: Record<string, string>) {
      super();
    }
    prepare(query: string): D1PreparedStatement {
      if (query.includes('FROM settings')) {
        return new SettingsStatement(
          this.executed,
          query,
          Object.entries(this.settingsRows).map(([k, v]) => ({ k, v })),
        );
      }
      return super.prepare(query);
    }
  }

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('TG 周报全部段失败 → INSERT 一条 notify_fail(telegram,suppressed=1,payload 含 sent/total/error)', async () => {
    const db = new SettingsD1Stub({ tg_weekly: 'true', tg_bot_token: 't', tg_chat_id: 'c' });
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('network down')));
    await sendWeeklyReport({ DB: db }, FRI);
    const ins = db.executed.filter((s) => s.sql.startsWith('INSERT INTO events'));
    expect(ins).toHaveLength(1);
    // 绑定顺序:(source_id, source_name, kind, model_id, dedup_group, suppressed, notified, payload, detected_at)
    expect(ins[0].params.slice(0, 6)).toEqual([0, 'telegram', 'notify_fail', null, 'notify:telegram', 1]);
    expect(JSON.parse(ins[0].params[7] as string)).toMatchObject({
      channel: 'telegram',
      sent: 0,
      total: 1,
      error: 'network down',
    });
    // 门控标记是 engine 职责(weekly() 正常返回即写回;发送失败被吞、仅落 notify_fail),此处不应写 settings
    expect(db.executed.some((s) => s.sql.includes('INSERT INTO settings'))).toBe(false);
  });

  it('邮件周报失败(SEND_EMAIL binding 未部署)→ INSERT 一条 notify_fail(email)', async () => {
    const db = new SettingsD1Stub({ email_weekly: 'true', email_from: 'a@b.c', email_to: 'd@e.f' });
    await sendWeeklyReport({ DB: db }, FRI); // 无 SEND_EMAIL binding → 失败分支,无需 mock fetch
    const ins = db.executed.filter((s) => s.sql.startsWith('INSERT INTO events'));
    expect(ins).toHaveLength(1);
    expect(ins[0].params[4]).toBe('notify:email');
    expect(ins[0].params[5]).toBe(1);
    const payload = JSON.parse(ins[0].params[7] as string);
    expect(payload.channel).toBe('email');
    expect(payload.error).toContain('SEND_EMAIL binding 未部署');
  });

  it('无已启用且配置完整的周报通道 → 不发送也不落失败事件(未尝试 ≠ 失败)', async () => {
    const db = new SettingsD1Stub({});
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await sendWeeklyReport({ DB: db }, FRI);
    expect(db.executed.filter((s) => s.sql.startsWith('INSERT INTO events'))).toHaveLength(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
