import { describe, expect, it } from 'vitest';
import {
  applyAllowlist,
  normalizeResponse,
  ResponseParseError,
  type NormalizedModel,
} from '../src/poll/normalize';

const asJson = (v: unknown): string => JSON.stringify(v);

describe('normalizeResponse:OpenRouter 式列表(data[].id)', () => {
  const body = asJson({
    data: [
      {
        id: 'openai/gpt-4o',
        name: 'OpenAI: GPT-4o',
        created: 1715217044,
        context_length: 128000,
        pricing: { prompt: '0.000005' },
      },
      { id: 'google/gemini-2.0-flash-001', context_length: 1048576 },
      { id: 'no-slash-model' },
      { id: 'openai/gpt-4o' }, // 响应内重复 id → 只留首个
      { object: 'model' }, // 无 id → 跳过
      null,
    ],
  });

  it('解析出 3 个模型;id 保留;provider 取 id 前缀(无前缀为 null)', () => {
    const out = normalizeResponse('catalog', body);
    expect(out.map((m) => m.id)).toEqual([
      'openai/gpt-4o',
      'google/gemini-2.0-flash-001',
      'no-slash-model',
    ]);
    expect(out[0].provider).toBe('openai');
    expect(out[1].provider).toBe('google');
    expect(out[2].provider).toBeNull();
  });

  it('snapshot 只挑富字段(name/created/context_length),不含 pricing 之外未挑选字段', () => {
    const out = normalizeResponse('catalog', body);
    const snap = JSON.parse(out[0].snapshot ?? '{}') as Record<string, unknown>;
    expect(snap['name']).toBe('OpenAI: GPT-4o');
    expect(snap['created']).toBe(1715217044);
    expect(snap['context_length']).toBe(128000);
    expect('pricing' in snap).toBe(false); // 未挑选字段不进快照
    expect(out[2].snapshot).toBeNull(); // 无富字段 → null
  });

  it('渠道源对同一结构只认 id、provider=null', () => {
    const out = normalizeResponse('channel', body);
    expect(out.map((m) => m.id)).toEqual(['openai/gpt-4o', 'google/gemini-2.0-flash-001', 'no-slash-model']);
    expect(out.every((m) => m.provider === null)).toBe(true);
  });
});

describe('normalizeResponse:models.dev 字典式(provider → models{slug → 字段})', () => {
  const body = asJson({
    openai: {
      models: {
        'gpt-4o': { name: 'GPT-4o', release_date: '2024-05-13' },
        'o1-preview': {},
      },
    },
    anthropic: {
      models: {
        // slug 已带前缀 → 原样保留,不再重复拼接
        'anthropic/claude-sonnet-4': { release_date: '2025-09-29' },
      },
    },
    broken: { not_models: {} }, // 结构异常的 provider → 跳过
    empty: { models: {} },
  });

  it('扁平化为 {provider}/{slug};无前缀 slug 补 provider 前缀;已有前缀不重复', () => {
    const out = normalizeResponse('catalog', body);
    expect(out.map((m) => m.id).sort()).toEqual(
      ['openai/gpt-4o', 'openai/o1-preview', 'anthropic/claude-sonnet-4'].sort(),
    );
  });

  it('provider 字段 = 字典键(models.dev 场景的 provider 名)', () => {
    const out = normalizeResponse('catalog', body);
    const byId = new Map(out.map((m) => [m.id, m]));
    expect(byId.get('openai/gpt-4o')?.provider).toBe('openai');
    expect(byId.get('anthropic/claude-sonnet-4')?.provider).toBe('anthropic');
  });

  it('snapshot 挑 name/release_date;空 detail → null', () => {
    const out = normalizeResponse('catalog', body);
    const byId = new Map(out.map((m) => [m.id, m]));
    expect(JSON.parse(byId.get('openai/gpt-4o')?.snapshot ?? '{}')).toMatchObject({
      name: 'GPT-4o',
      release_date: '2024-05-13',
    });
    expect(byId.get('openai/o1-preview')?.snapshot).toBeNull();
  });
});

describe('normalizeResponse:models.dev 扁平字典(/models.json,lab/model → 富字段)', () => {
  const body = asJson({
    'bytedance-seed/seed-2.0-pro': {
      name: 'Seed 2.0 Pro',
      release_date: '2026-02-14',
      input_modalities: ['text', 'image'], // 未挑选字段不进快照
    },
    'openai/gpt-4o': {}, // 无富字段 → snapshot=null
    'no-slash-key': { name: '应跳过' }, // 键不含 / 且无 .models → 跳过
    'bad/value': 42, // 值非 record → 跳过
    'null/value': null,
  });

  it('id=键;provider=首个 / 的前缀;无 / 键与非 record 值跳过', () => {
    const out = normalizeResponse('catalog', body);
    expect(out.map((m) => m.id)).toEqual(['bytedance-seed/seed-2.0-pro', 'openai/gpt-4o']);
    expect(out[0].provider).toBe('bytedance-seed');
    expect(out[1].provider).toBe('openai');
  });

  it('snapshot 只挑 name/release_date;空对象 → null', () => {
    const out = normalizeResponse('catalog', body);
    expect(JSON.parse(out[0].snapshot ?? '{}')).toMatchObject({
      name: 'Seed 2.0 Pro',
      release_date: '2026-02-14',
    });
    expect('input_modalities' in (JSON.parse(out[0].snapshot ?? '{}') as Record<string, unknown>)).toBe(false);
    expect(out[1].snapshot).toBeNull();
  });
});

describe('normalizeResponse:二层与扁平字典混合共存(分派规则)', () => {
  const body = asJson({
    openai: { models: { 'gpt-4o': { name: 'GPT-4o', release_date: '2024-05-13' } } }, // 二层条目
    'anthropic/claude-sonnet-4': { release_date: '2025-09-29' }, // 扁平条目
    'weird/lab': { models: { x: {} } }, // 含 .models 优先按二层分派(键含 / 不改变优先级)
    'openai/gpt-4o': { name: '与二层产出的 id 撞车' }, // 与二层 slug 拼接结果重复 → 只留首个
    broken: { not_models: {} }, // 无 / 且无 .models → 跳过
  });

  it('含 .models 的条目走二层;其余键含 / 的 record 走扁平', () => {
    const out = normalizeResponse('catalog', body);
    const byId = new Map(out.map((m) => [m.id, m]));
    expect(byId.get('openai/gpt-4o')?.provider).toBe('openai'); // 二层产出,未被扁平同名键覆盖
    expect(byId.get('anthropic/claude-sonnet-4')?.provider).toBe('anthropic');
    expect(byId.get('weird/lab/x')).toBeDefined(); // .models 优先,即使键含 /
    expect(byId.get('weird/lab/x')?.provider).toBe('weird/lab');
  });

  it('响应内 id 去重跨分支生效(二层先出现,扁平同名键跳过)', () => {
    const out = normalizeResponse('catalog', body);
    expect(out.filter((m) => m.id === 'openai/gpt-4o')).toHaveLength(1);
    expect(out).toHaveLength(3);
  });
});

describe('normalizeResponse:渠道源(OpenAI 兼容,data[].id)', () => {
  it('created 进 snapshot(仅展示,不参与判定)', () => {
    const out = normalizeResponse('channel', asJson({ data: [{ id: 'zen/qwen3-coder', created: 1760000000 }, { id: 'x' }] }));
    expect(out.map((m) => m.id)).toEqual(['zen/qwen3-coder', 'x']);
    expect(JSON.parse(out[0].snapshot ?? '{}')).toMatchObject({ created: 1760000000 });
    expect(out[1].snapshot).toBeNull();
  });

  it('响应内重复 id 只留首个', () => {
    const out = normalizeResponse('channel', asJson({ data: [{ id: 'a' }, { id: 'a' }] }));
    expect(out).toHaveLength(1);
  });
});

describe('normalizeResponse:异常输入', () => {
  it('非法 JSON → ResponseParseError', () => {
    expect(() => normalizeResponse('catalog', 'not-json{')).toThrow(ResponseParseError);
    expect(() => normalizeResponse('channel', '')).toThrow(ResponseParseError);
  });

  it('渠道源缺 data 数组 → ResponseParseError', () => {
    expect(() => normalizeResponse('channel', asJson({ object: 'list' }))).toThrow(ResponseParseError);
    expect(() => normalizeResponse('channel', asJson({ data: {} }))).toThrow(ResponseParseError);
  });

  it('目录源:非 data 结构的对象容错为空数组(0 模型由 engine 按解析失败处理);顶层数组 → 抛错', () => {
    expect(normalizeResponse('catalog', asJson({ foo: 1 }))).toEqual<NormalizedModel[]>([]);
    expect(() => normalizeResponse('catalog', asJson([1, 2]))).toThrow(ResponseParseError);
  });
});

describe('applyAllowlist(仅目录源;空 = 全量,spec:product/data-sources.md)', () => {
  const models: NormalizedModel[] = [
    { id: 'openai/gpt-4o', provider: 'openai', snapshot: null },
    { id: 'google/gemini-2.0-flash', provider: 'Google', snapshot: null }, // 大小写不敏感
    { id: 'no-provider-model', provider: null, snapshot: null },
    { id: 'anthropic/claude-4', provider: 'anthropic', snapshot: null },
  ];

  it('空 allowlist → 全量', () => {
    expect(applyAllowlist(models, [])).toHaveLength(4);
    expect(applyAllowlist(models, [''])).toHaveLength(4); // trim 后为空 = 全量
  });

  it('按 provider 过滤,大小写不敏感;provider=null 的模型在非空白名单下被过滤', () => {
    const out = applyAllowlist(models, ['OpenAI', 'google']);
    expect(out.map((m) => m.id)).toEqual(['openai/gpt-4o', 'google/gemini-2.0-flash']);
  });

  it('白名单含未匹配项 → 结果可为空', () => {
    expect(applyAllowlist(models, ['mistral'])).toHaveLength(0);
  });
});
