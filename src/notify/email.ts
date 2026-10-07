/**
 * 邮件发送(spec:product/notifications.md / design §7):transport 按 settings.email_transport。
 * - send_email binding(主力):结构化对象 env.SEND_EMAIL.send({to,from,subject,html,text});
 *   收件人即 settings.email_to(binding 无需在 wrangler.toml 配地址)
 * - Resend(后备):POST https://api.resend.com/emails,Bearer resend_api_key
 * 失败只 console.error 记日志,不抛出(不中断 cron / 周报)。
 */
import type { Env } from '../env';
import type { SettingsMap } from '../db/settings';
import type { EmailMessage } from './render';

export function emailTransport(settings: SettingsMap): 'send_email' | 'resend' {
  return settings['email_transport'] === 'resend' ? 'resend' : 'send_email';
}

/** 通道是否具备发送条件(from/to 为必需;resend 还需 api key) */
export function emailConfigured(settings: SettingsMap): boolean {
  const from = settings['email_from']?.trim();
  const to = settings['email_to']?.trim();
  if (!from || !to) return false;
  if (emailTransport(settings) === 'resend' && !settings['resend_api_key']?.trim()) return false;
  return true;
}

/** 发送;成功 true,失败/未配置 false(失败细节进日志) */
export async function sendEmail(
  env: Env,
  settings: SettingsMap,
  msg: EmailMessage,
): Promise<boolean> {
  const to = settings['email_to']?.trim();
  const from = settings['email_from']?.trim();
  if (!to || !from) {
    console.error('[notify] email 跳过:email_to / email_from 未配置');
    return false;
  }
  const structured = { to, from, subject: msg.subject, html: msg.html, text: msg.text };

  if (emailTransport(settings) === 'resend') {
    const key = settings['resend_api_key']?.trim();
    if (!key) {
      console.error('[notify] email 跳过:transport=resend 但 resend_api_key 未配置');
      return false;
    }
    try {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
        body: JSON.stringify(structured),
      });
      if (!res.ok) {
        console.error(`[notify] Resend 发送失败: HTTP ${res.status} ${await res.text().catch(() => '')}`);
        return false;
      }
      return true;
    } catch (err) {
      console.error('[notify] Resend 请求异常:', err);
      return false;
    }
  }

  if (!env.SEND_EMAIL) {
    console.error('[notify] email 跳过:transport=send_email 但 SEND_EMAIL binding 未部署(需 Dashboard 开启 Email)');
    return false;
  }
  try {
    await env.SEND_EMAIL.send(structured);
    return true;
  } catch (err) {
    console.error('[notify] send_email binding 发送失败:', err);
    return false;
  }
}
