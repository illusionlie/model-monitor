import { describe, expect, it } from 'vitest';
import type { EventInsert } from '../src/db/events';
import {
  DEGRADE_THRESHOLD,
  groupBySource,
  renderRoundEmail,
  renderRoundTg,
  renderWeeklyEmail,
  renderWeeklyTg,
  type WeeklyData,
} from '../src/notify/render';
import { formatDualTimeLines } from '../src/lib/time';

const NOW = new Date('2026-10-07T07:30:00.000Z'); // 北京 2026-10-07 15:30(PRD mockup 时间)

const ev = (over: Partial<EventInsert>): EventInsert => ({
  source_id: 1,
  source_name: 'OpenRouter',
  kind: 'added',
  model_id: 'openai/gpt-x',
  dedup_group: 'catalog',
  suppressed: 0,
  notified: 0,
  payload: null,
  detected_at: NOW.toISOString(),
  ...over,
});

/** n 个 added(m-from … m-(from+n-1)) */
const mkAdded = (n: number, from = 1): EventInsert[] =>
  Array.from({ length: n }, (_, i) => ev({ model_id: `openai/m-${from + i}` }));

const RICH = '{"name":"GPT-5.1","context_length":400000,"release_date":"2025-08-07"}';
const MIXED: EventInsert[] = [
  ev({ model_id: 'openai/gpt-5.1', payload: RICH }),
  ev({ model_id: 'openai/bare' }),
  ev({ kind: 'delisted', model_id: 'google/gemini-2.5-flash' }),
];

describe('formatDualTimeLines(PRD R1:两行时间头部)', () => {
  it('北京时间 / UTC时间 各一行,两行均带完整日期', () => {
    expect(formatDualTimeLines(NOW)).toBe('北京时间 2026-10-07 15:30\nUTC时间 2026-10-07 07:30');
  });

  it('北京与 UTC 跨日时日期各自独立', () => {
    expect(formatDualTimeLines(new Date('2026-10-07T18:30:00.000Z'))).toBe(
      '北京时间 2026-10-08 02:30\nUTC时间 2026-10-07 18:30',
    );
  });

  it('接受 ISO 字符串入参', () => {
    expect(formatDualTimeLines('2026-10-07T07:30:00.000Z')).toContain('北京时间 2026-10-07 15:30');
    expect(formatDualTimeLines('2026-10-07T07:30:00.000Z')).toContain('UTC时间 2026-10-07 07:30');
  });
});

describe('renderRoundTg:diffstat 段头 + 合并 diff 块(PRD R2)', () => {
  it('± 混合单源:段头 +2 -1,一个 blockquote,added 在前 delisted 在后,两行时间头部', () => {
    const tg = renderRoundTg(MIXED, NOW);
    expect(tg).toContain('📡 <b>模型监视 · 本轮变更</b>');
    expect(tg).toContain('北京时间 2026-10-07 15:30\nUTC时间 2026-10-07 07:30');
    expect(tg).toContain('<b>OpenRouter</b> <b>+2</b> <b>-1</b>');
    expect(tg.match(/<blockquote expandable>/g)).toHaveLength(1);
    expect(tg.indexOf('+ <code>openai/gpt-5.1</code>')).toBeLessThan(
      tg.indexOf('- <code>google/gemini-2.5-flash</code>'),
    );
    // 富字段:显示名 · ctx · 日期(沿用 modelLineTg 逻辑)
    expect(tg).toContain('+ <code>openai/gpt-5.1</code> · GPT-5.1 · ctx 400k · 2025-08-07');
    // 富字段缺失:行只有 code 部分
    expect(tg).toMatch(/\+ <code>openai\/bare<\/code>\n/);
    // delisted 不带富字段
    expect(tg).toContain('- <code>google/gemini-2.5-flash</code>');
  });

  it('段头仅显示非零计数:只有 added 无 -0,只有 delisted 无 +0', () => {
    const add = renderRoundTg(mkAdded(2), NOW);
    expect(add).toContain('<b>OpenRouter</b> <b>+2</b>');
    expect(add).not.toContain('<b>-0</b>');
    const del = renderRoundTg([ev({ kind: 'delisted', model_id: 'a/b' })], NOW);
    expect(del).toContain('<b>OpenRouter</b> <b>-1</b>');
    expect(del).not.toContain('<b>+0</b>');
  });

  it('系统消息行措辞(seed/fail/recovered);纯系统源无 diffstat 段头与 blockquote', () => {
    const tg = renderRoundTg(
      [
        ev({ source_id: 2, source_name: 'BigModel', kind: 'seed', model_id: null, payload: '{"count":42}' }),
        ev({ source_id: 3, source_name: 'Zen', kind: 'source_fail', model_id: null, payload: '{"consecutive_failures":3,"error":"HTTP 502"}' }),
        ev({ source_id: 4, source_name: 'Cline', kind: 'source_recovered', model_id: null }),
      ],
      NOW,
    );
    expect(tg).toContain('✅ <b>BigModel</b> 已接入 · 存量 42 个模型(静默 seed)');
    expect(tg).toContain('⚠️ <b>Zen</b> 连续 3 次探测失败 · HTTP 502');
    expect(tg).toContain('🛩️ <b>Cline</b> 探测已恢复');
    expect(tg).not.toContain('<b>+0</b>');
    expect(tg).not.toContain('<blockquote');
  });

  it('转义:源名/错误信息/脏 release_date 含 HTML 字符时全部转义', () => {
    const tg = renderRoundTg(
      [
        ev({
          source_id: 5,
          source_name: 'A&Co <lab>',
          kind: 'source_fail',
          model_id: null,
          payload: '{"consecutive_failures":2,"error":"fetch <timeout> &5xx"}',
        }),
        ev({ model_id: 'x/y', payload: '{"release_date":"2026<09>07"}' }),
      ],
      NOW,
    );
    expect(tg).toContain('⚠️ <b>A&amp;Co &lt;lab&gt;</b> 连续 2 次探测失败 · fetch &lt;timeout&gt; &amp;5xx');
    expect(tg).toContain('· 2026&lt;09&gt;07');
  });

  it(`降级边界:added=${DEGRADE_THRESHOLD} 全量内联;${DEGRADE_THRESHOLD + 1} 仅列前 3 + 其余计数`, () => {
    const ok = renderRoundTg(mkAdded(DEGRADE_THRESHOLD), NOW);
    expect(ok).toContain(`+ <code>openai/m-${DEGRADE_THRESHOLD}</code>`);
    expect(ok).not.toContain('完整列表见 /feed');
    const bad = renderRoundTg(mkAdded(DEGRADE_THRESHOLD + 1), NOW);
    expect(bad).toContain('+ <code>openai/m-3</code>');
    expect(bad).not.toContain('+ <code>openai/m-4</code>');
    expect(bad).toContain(`…其余 ${DEGRADE_THRESHOLD + 1 - 3} 个,完整列表见 /feed`);
    // 降级行是块内末行(紧贴 </blockquote>)
    expect(bad).toContain(`…其余 ${DEGRADE_THRESHOLD + 1 - 3} 个,完整列表见 /feed\n</blockquote>`);
  });
});

describe('renderRoundEmail:GitHub diff 卡片 + 全量 inline style(PRD R3)', () => {
  const email = renderRoundEmail(MIXED, NOW);

  it('主题为 diffstat;全零 + seed 时为「无新增/下架 · 新源 N」', () => {
    expect(email.subject).toBe('📡 模型监视:+2 -1');
    const onlySeed = renderRoundEmail(
      [ev({ kind: 'seed', model_id: null, payload: '{"count":7}' })],
      NOW,
    );
    expect(onlySeed.subject).toBe('📡 模型监视:无新增/下架 · 新源 1');
  });

  it('无 <style> 块、无 CSS 规则集、style 属性内无嵌套双引号(字体名单引号)', () => {
    expect(email.html).not.toContain('<style');
    expect(email.html).not.toContain('</style');
    expect(email.html).not.toContain('{');
    const opens = (email.html.match(/style="/g) ?? []).length;
    expect(opens).toBeGreaterThan(0);
    // 剥掉所有完整「属性="值"」后不允许残留双引号 → 属性值内无嵌套双引号
    expect(email.html.replace(/="[^"]*"/g, '')).not.toContain('"');
    expect(email.html).toContain("'PingFang SC'");
  });

  it('diff 行 bgcolor 属性与 style background-color 双写,added/delisted 各配色', () => {
    expect(email.html).toContain('bgcolor="#e6ffec"');
    expect(email.html).toContain('background-color:#e6ffec');
    expect(email.html).toContain('bgcolor="#ffebe9"');
    expect(email.html).toContain('background-color:#ffebe9');
    expect(email.html).toContain('color:#1a7f37');
    expect(email.html).toContain('color:#cf222e');
  });

  it('卡片外壳、文件头 diffstat、标题与两行时间、富字段淡化', () => {
    expect(email.html).toContain('bgcolor="#f6f8fa"');
    expect(email.html).toContain('background-color:#f6f8fa');
    expect(email.html).toContain('max-width:680px');
    expect(email.html).toContain('border:1px solid #d0d7de');
    expect(email.html).toContain(
      '<strong>OpenRouter</strong> <span style="color:#1a7f37;font-weight:600">+2</span> <span style="color:#cf222e;font-weight:600">-1</span>',
    );
    expect(email.html).toContain('>📡 模型监视 · 本轮变更</h2>');
    expect(email.html).toContain('北京时间 2026-10-07 15:30<br>UTC时间 2026-10-07 07:30');
    expect(email.html).toContain(
      '+ openai/gpt-5.1 <span style="opacity:0.75">· GPT-5.1 · ctx 400k · 2025-08-07</span>',
    );
  });

  it('text 版与 TG 同构:两行时间、源名 diffstat 行、+/- 前缀行、[接入]/[失败]/[恢复] 前缀', () => {
    expect(email.text).toContain('北京时间 2026-10-07 15:30\nUTC时间 2026-10-07 07:30');
    expect(email.text).toContain('OpenRouter +2 -1');
    expect(email.text).toContain('+ openai/gpt-5.1 · GPT-5.1 · ctx 400k · 2025-08-07');
    expect(email.text).toContain('+ openai/bare');
    expect(email.text).toContain('- google/gemini-2.5-flash');
    const sys = renderRoundEmail(
      [
        ev({ kind: 'seed', model_id: null, payload: '{"count":42}' }),
        ev({ kind: 'source_fail', model_id: null, payload: '{"consecutive_failures":3,"error":"HTTP 502"}' }),
        ev({ kind: 'source_recovered', model_id: null }),
      ],
      NOW,
    );
    expect(sys.text).toContain('[接入] OpenRouter:存量 42 个模型(静默 seed)');
    expect(sys.text).toContain('[失败] OpenRouter:连续 3 次探测失败 · HTTP 502');
    expect(sys.text).toContain('[恢复] OpenRouter:探测已恢复');
  });

  it(`邮件降级行 @@ … @@(bgcolor 双写,text 版同步)`, () => {
    const bad = renderRoundEmail(mkAdded(DEGRADE_THRESHOLD + 1), NOW);
    expect(bad.html).toContain(
      `@@ 仅列前 3 个,共 ${DEGRADE_THRESHOLD + 1} 个 · 完整列表见 /feed @@`,
    );
    expect(bad.html).toContain('bgcolor="#f2f5f8"');
    expect(bad.html).toContain('background-color:#f2f5f8');
    expect(bad.text).toContain(
      `@@ 仅列前 3 个,共 ${DEGRADE_THRESHOLD + 1} 个 · 完整列表见 /feed @@`,
    );
  });
});

describe('周报 renderWeeklyTg / renderWeeklyEmail(PRD R2/R3)', () => {
  const data: WeeklyData = {
    weekId: '2026-W41',
    fromIso: '2026-10-04T16:00:00.000Z', // 北京周一 2026-10-05 00:00
    toIso: NOW.toISOString(),
    sections: groupBySource(MIXED),
    addedCount: 2,
    delistedCount: 1,
    failCount: 1,
    seedCount: 0,
    recoveredCount: 0,
    modelCounts: new Map([[1, 42]]),
    sourceNames: new Map([[1, 'OpenRouter']]),
  };
  const quiet: WeeklyData = {
    ...data,
    sections: [],
    addedCount: 0,
    delistedCount: 0,
    failCount: 0,
  };

  it('renderWeeklyTg:标题 + 两行时间 + 统计自行 + 统计行 + section + 当前在架', () => {
    const tg = renderWeeklyTg(data, NOW);
    expect(tg).toContain('📊 <b>模型监视 · 周报 2026-W41</b>');
    expect(tg).toContain('北京时间 2026-10-07 15:30\nUTC时间 2026-10-07 07:30');
    expect(tg).toContain('统计自 北京 2026-10-05 00:00 (UTC 16:00) 起');
    expect(tg).toContain('本周:新增 2 · 下架 1 · 失败告警 1 · 新源接入 0');
    expect(tg).toContain('<b>OpenRouter</b> <b>+2</b> <b>-1</b>');
    expect(tg).toContain('当前在架:OpenRouter 42');
  });

  it('renderWeeklyTg:无事件周 → 一切平静', () => {
    expect(renderWeeklyTg(quiet, NOW)).toContain('本周无新增/下架事件,一切平静 🌿');
  });

  it('renderWeeklyEmail:主题 + 统计行 + 当前在架 + text 版', () => {
    const em = renderWeeklyEmail(data, NOW);
    expect(em.subject).toBe('📊 模型监视周报 2026-W41:+2 -1');
    expect(em.html).toContain('📊 模型监视 · 周报 2026-W41</h2>');
    expect(em.html).toContain('统计自 北京 2026-10-05 00:00 (UTC 16:00) 起');
    expect(em.html).toContain(
      '本周:新增 <strong>2</strong> · 下架 <strong>1</strong> · 失败告警 1 · 新源接入 0',
    );
    expect(em.html).toContain('<strong>当前在架</strong>');
    expect(em.text).toContain('本周:新增 2 · 下架 1 · 失败告警 1 · 新源接入 0');
    expect(em.text).toContain('当前在架:OpenRouter 42');
  });

  it('renderWeeklyEmail:无事件周 → 静默文案 + 主题兜底', () => {
    const em = renderWeeklyEmail(quiet, NOW);
    expect(em.html).toContain('<p>本周无新增/下架事件,一切平静 🌿</p>');
    expect(em.subject).toBe('📊 模型监视周报 2026-W41:无新增/下架');
    expect(em.text).toContain('本周无新增/下架事件,一切平静 🌿');
  });

  it('周报「当前在架」:TG/HTML 侧转义,text 版保持原文(不出现 &amp;)', () => {
    const d: WeeklyData = {
      ...data,
      modelCounts: new Map([[9, 3]]),
      sourceNames: new Map([[9, 'A&Co']]),
    };
    expect(renderWeeklyTg(d, NOW)).toContain('当前在架:A&amp;Co 3');
    const em = renderWeeklyEmail(d, NOW);
    expect(em.html).toContain('A&amp;Co:<strong>3</strong> 个在架');
    expect(em.text).toContain('当前在架:A&Co 3');
    expect(em.text).not.toContain('&amp;');
  });
});
