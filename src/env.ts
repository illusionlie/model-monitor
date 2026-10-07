/**
 * Worker 绑定类型(design §1/§3)。
 * 业务 secrets 一律存 D1 settings(spec:product/notifications.md);env 与 GitHub secrets 只放部署凭据。
 */

/** send_email binding:构造发件用结构化对象(spec:product/notifications.md,不用 PostalMime) */
export interface SendEmailMessage {
  to: string | string[];
  from: string;
  subject: string;
  html?: string;
  text?: string;
}

export interface SendEmailBinding {
  send(message: SendEmailMessage): Promise<unknown>;
}

export interface Env {
  DB: D1Database;
  /** Dashboard 开启 Email 后才有;本地 dev 可缺省 */
  SEND_EMAIL?: SendEmailBinding;
}
