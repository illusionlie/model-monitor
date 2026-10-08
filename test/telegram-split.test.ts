import { afterEach, describe, expect, it, vi } from 'vitest';
import { notifyTelegram, splitTelegramHtml, TG_BUDGET } from '../src/notify/telegram';

/** 构造一条典型的本轮变更消息:标题 + 时间 + 每源一节(blockquote 包模型列表) */
function buildMessage(modelCount: number, lineLen = 60): string {
  const lines: string[] = ['📡 <b>模型监视 · 本轮变更</b>', '北京 2026-10-09 21:00 (UTC 13:00)', ''];
  const pad = (i: number): string =>
    `• provider/model-${String(i).padStart(4, '0')}`.padEnd(lineLen, '·');
  lines.push('<b>【OpenRouter】</b>新增 ' + modelCount + ' 个:');
  lines.push('<blockquote expandable>');
  for (let i = 0; i < modelCount; i++) lines.push(pad(i));
  lines.push('</blockquote>');
  return lines.join('\n');
}

describe('TG 分段(design §7:3800 预算 / 行边界 / 段头 / blockquote 补全)', () => {
  it('空输入 → 空数组(不发)', () => {
    expect(splitTelegramHtml('')).toEqual([]);
  });

  it('短消息 → 单段原样返回(不加段头)', () => {
    const msg = buildMessage(5);
    const parts = splitTelegramHtml(msg, TG_BUDGET);
    expect(parts).toEqual([msg]);
    expect(parts[0].length).toBeLessThanOrEqual(TG_BUDGET);
  });

  it('超长消息 → 多段;每段 ≤ 预算;段头带 (i/n);首行边界切分', () => {
    const msg = buildMessage(200, 60); // 200 行 × 60 字符 ≈ 12k 字符
    const parts = splitTelegramHtml(msg, TG_BUDGET);
    expect(parts.length).toBeGreaterThan(1);
    const n = parts.length;
    parts.forEach((p, i) => {
      expect(p.length).toBeLessThanOrEqual(TG_BUDGET);
      expect(p.split('\n')[0]).toBe(`📡 <b>模型监视 · 本轮变更</b> (${i + 1}/${n})`);
      // 段内每行都不被截断(行边界切分;段头单独一行)
      for (const line of p.split('\n')) {
        if (line.startsWith('•')) expect(line.length).toBe(60);
      }
    });
  });

  it('内容无丢失:所有模型行在分段后各出现一次', () => {
    const msg = buildMessage(150, 50);
    const parts = splitTelegramHtml(msg, TG_BUDGET);
    const all = parts.join('\n');
    for (let i = 0; i < 150; i++) {
      const needle = `provider/model-${String(i).padStart(4, '0')}`;
      const occurrences = all.split(needle).length - 1;
      expect(occurrences).toBe(1);
    }
  });

  it('切点落在 blockquote 内 → 段尾闭合、下段重开,各段标签配平', () => {
    const msg = buildMessage(300, 70);
    const parts = splitTelegramHtml(msg, TG_BUDGET);
    expect(parts.length).toBeGreaterThan(2);
    let opens = 0;
    let closes = 0;
    for (const p of parts) {
      opens += (p.match(/<blockquote/g) ?? []).length;
      closes += (p.match(/<\/blockquote>/g) ?? []).length;
      // 每段自身配平(HTML 合法性)
      expect((p.match(/<blockquote/g) ?? []).length).toBe((p.match(/<\/blockquote>/g) ?? []).length);
    }
    expect(opens).toBe(closes);
  });

  it('自定义小预算:预算 300 也正确切分且不超限', () => {
    const msg = buildMessage(40, 50);
    const parts = splitTelegramHtml(msg, 300);
    expect(parts.length).toBeGreaterThan(1);
    for (const p of parts) expect(p.length).toBeLessThanOrEqual(300);
  });
});

describe('notifyTelegram:失败段收集 errors(任务 10-08-notify-fail-event,mock fetch)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('单段且失败(fetch 异常)→ sent=0,errors 含异常摘要(≤200 字符)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('fetch failed')));
    const r = await notifyTelegram('t', 'c', 'hello');
    expect(r.sent).toBe(0);
    expect(r.total).toBe(1);
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0]).toContain('fetch failed');
    expect(r.errors[0]!.length).toBeLessThanOrEqual(200);
  });

  it('多段部分失败(第 2 段 HTTP 429)→ 成功段计 sent,失败段摘要进 errors', async () => {
    const long = 'a'.repeat(3000);
    const msg = ['T', long, long].join('\n');
    expect(splitTelegramHtml(msg)).toHaveLength(2); // 前置:确为 2 段
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response('{"ok":true}', { status: 200 }))
      .mockResolvedValue(new Response('{"ok":false,"description":"Too Many Requests"}', { status: 429 }));
    vi.stubGlobal('fetch', fetchMock);
    const r = await notifyTelegram('t', 'c', msg);
    expect(r.sent).toBe(1);
    expect(r.total).toBe(2);
    expect(r.errors).toEqual(['Telegram sendMessage HTTP 429']);
  });

  it('非 2xx 且 body ok=false → 摘要取 HTTP 状态行;全部成功 → errors 为空', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('{"ok":true}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const r = await notifyTelegram('t', 'c', 'hello');
    expect(r.sent).toBe(1);
    expect(r.total).toBe(1);
    expect(r.errors).toEqual([]);
  });
});
