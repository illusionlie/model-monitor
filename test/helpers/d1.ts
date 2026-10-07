/**
 * 最小内存 D1 stub(首例,供 SQL 与绑定参数断言):
 * 不实现真实 SQL 语义,只把 run/all/first/raw 执行的语句与参数按序记入 executed;batch 逐条展开记录。
 */

export interface ExecutedStatement {
  sql: string;
  params: unknown[];
}

function emptyMeta(): D1Meta & Record<string, unknown> {
  return {
    duration: 0,
    size_after: 0,
    rows_read: 0,
    rows_written: 0,
    last_row_id: 0,
    changed_db: false,
    changes: 0,
  };
}

class StubStatement implements D1PreparedStatement {
  constructor(
    private readonly executed: ExecutedStatement[],
    readonly sql: string,
    private params: unknown[] = [],
  ) {}
  bind(...values: unknown[]): D1PreparedStatement {
    this.params = values;
    return this;
  }
  private record(): void {
    this.executed.push({ sql: this.sql, params: this.params });
  }
  async first<T = Record<string, unknown>>(): Promise<T | null> {
    this.record();
    return null;
  }
  async all<T = Record<string, unknown>>(): Promise<D1Result<T>> {
    this.record();
    return { success: true, meta: emptyMeta(), results: [] };
  }
  async raw<T = unknown[]>(options: { columnNames: true }): Promise<[string[], ...T[]]>;
  async raw<T = unknown[]>(options?: { columnNames?: false }): Promise<T[]>;
  async raw<T = unknown[]>(options?: { columnNames?: boolean }): Promise<T[] | [string[], ...T[]]> {
    this.record();
    return [] as unknown as T[] | [string[], ...T[]];
  }
  async run<T = Record<string, unknown>>(): Promise<D1Result<T>> {
    this.record();
    return { success: true, meta: emptyMeta(), results: [] };
  }
}

export class D1Stub implements D1Database {
  /** 已执行语句(按执行顺序;batch 展开为多条) */
  readonly executed: ExecutedStatement[] = [];

  prepare(query: string): D1PreparedStatement {
    return new StubStatement(this.executed, query);
  }

  async batch<T = unknown>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]> {
    const results: D1Result<T>[] = [];
    for (const s of statements) results.push((await s.run()) as D1Result<T>);
    return results;
  }

  async exec(): Promise<D1ExecResult> {
    throw new Error('D1Stub 不支持 exec');
  }
  withSession(): D1DatabaseSession {
    throw new Error('D1Stub 不支持 withSession');
  }
  async dump(): Promise<ArrayBuffer> {
    throw new Error('D1Stub 不支持 dump');
  }
}
