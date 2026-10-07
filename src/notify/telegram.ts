/**
 * Telegram sendMessage(spec:product/notifications.md / design §7):
 * - HTML parse_mode;单条 ≤4096 字符(实体解析后)→ 保守按 3800 预算预分段
 * - 切分只发生在行边界;若切点落在 <blockquote expandable> 内,补闭合/重开标签
 * - 多段时每段补头部「标题 (i/n)」;同 chat 限速 1 条/秒——段间与**跨消息**
 *   (实时通知 → 周报背靠背、测试通知 → 立即运行)统一由模块级 lastSendAtMs 节流
 * - 单段失败只 console.error,不重试不阻塞其余段
 */
import type { SettingsMap } from '../db/settings';

export const TG_BUDGET = 3800;
const SEGMENT_SLEEP_MS = 1000;
/** 与 notify/email.ts::emailConfigured 对称:通道是否具备发送条件(token + chat id) */
export function tgConfigured(settings: SettingsMap): boolean {
  return Boolean(settings['tg_bot_token']?.trim() && settings['tg_chat_id']?.trim());
}
/** 段头 "(i/n)" + 换行 + 切点处 blockquote 重开的长度余量 */
const HEADER_MARGIN = 16;
/** 行内闭合 </blockquote> 的长度余量(保证加余量后仍 ≤ 预算) */
const CLOSE_MARGIN = 16;

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/**
 * 预转义后的 TG HTML → 分段数组。
 * 输入约定:第一行是标题(分段时复用为段头);空输入 → []。
 * 纯函数,单测覆盖(telegram-split.test.ts)。
 */
export function splitTelegramHtml(html: string, budget: number = TG_BUDGET): string[] {
  if (!html) return [];
  const lines = html.split('\n');
  const title = lines[0] ?? '';

  // 内容预算 = 总预算 − 段头最长占用 − 切点闭合标签余量(下限保护,防超长标题)
  const contentBudget = Math.max(100, budget - title.length - HEADER_MARGIN - CLOSE_MARGIN);

  const segments: string[][] = [];
  let current: string[] = [];
  let curLen = 0;
  let inQuote = false;

  const pushSegment = (): void => {
    segments.push(current);
    current = [];
    curLen = 0;
  };

  const appendLine = (line: string): void => {
    if (current.length) curLen += 1; // 行间换行符计入预算
    // 病态超长单行(远超预算)按字符硬切,避免死循环
    let rest = line;
    while (rest.length > contentBudget - curLen) {
      const room = Math.max(1, contentBudget - curLen);
      current.push(rest.slice(0, room));
      rest = rest.slice(room);
      curLen = contentBudget;
      if (inQuote) current.push('</blockquote>');
      pushSegment();
      current.push('<blockquote expandable>');
      curLen = '<blockquote expandable>'.length;
    }
    current.push(rest);
    curLen += rest.length;
  };

  for (const rawLine of lines.slice(1)) {
    const cost = rawLine.length + (current.length ? 1 : 0); // 换行符
    if (current.length > 0 && curLen + cost > contentBudget) {
      if (inQuote) {
        current.push('</blockquote>');
      }
      pushSegment();
      if (inQuote) {
        current.push('<blockquote expandable>');
        curLen = '<blockquote expandable>'.length;
      }
    }
    appendLine(rawLine);

    const opens = (rawLine.match(/<blockquote/g) ?? []).length;
    const closes = (rawLine.match(/<\/blockquote>/g) ?? []).length;
    if (opens > closes) inQuote = true;
    else if (closes > opens) inQuote = false;
  }
  if (current.length) pushSegment();
  if (segments.length === 0) segments.push([]);

  if (segments.length === 1) return [html]; // 单段原样返回(不加段头)

  const n = segments.length;
  return segments.map((seg, i) => [`${title} (${i + 1}/${n})`, ...seg].join('\n'));
}

export interface TelegramSendResult {
  sent: number; // 成功段数
  total: number;
}

async function sendSegment(token: string, chatId: string, text: string): Promise<void> {
  const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      parse_mode: 'HTML',
      link_preview_options: { is_disabled: true },
    }),
  });
  if (!res.ok) throw new Error(`Telegram sendMessage HTTP ${res.status}`);
  const body = (await res.json().catch(() => null)) as { ok?: boolean; description?: string } | null;
  if (body && body.ok === false) throw new Error(`Telegram API: ${body.description ?? 'unknown'}`);
}

/** 同 chat 最近一次发送时刻(模块级:同一 isolate 内跨调用生效,保证任意两次发送间隔 ≥1s) */
let lastSendAtMs = 0;

/** 分段发送 + 1 msg/s 节流(段间与跨消息一致);单段失败 console.error 不阻塞 */
export async function notifyTelegram(
  token: string,
  chatId: string,
  html: string,
  budget: number = TG_BUDGET,
): Promise<TelegramSendResult> {
  const parts = splitTelegramHtml(html, budget);
  let sent = 0;
  for (let i = 0; i < parts.length; i++) {
    const waitMs = lastSendAtMs + SEGMENT_SLEEP_MS - Date.now();
    if (waitMs > 0) await sleep(waitMs);
    try {
      await sendSegment(token, chatId, parts[i]);
      lastSendAtMs = Date.now();
      sent++;
    } catch (err) {
      console.error(`[notify] TG 第 ${i + 1}/${parts.length} 段发送失败(不阻塞其余段):`, err);
    }
  }
  return { sent, total: parts.length };
}
