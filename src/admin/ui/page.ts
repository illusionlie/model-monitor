/**
 * 页面骨架(design §4.1/§4.3):内联 BASE_CSS + 防 FOUC 主题脚本 + body。
 * 主题脚本同步执行于 <style> 之后、<body> 之前:localStorage 合法值(light/dark)在首帧前落到
 * <html data-theme>,配合 CSS 变量三态层(见 css.ts)实现无闪白。
 * 注意:客户端脚本内禁用反引号与 "${",避免与 TS 模板字面量冲突。
 */
import { BASE_CSS } from './css';

const THEME_BOOT = `<script>
try{var __t=localStorage.getItem('mm_theme');if(__t==='light'||__t==='dark')document.documentElement.dataset.theme=__t;}catch(e){}
</script>`;

export function page(title: string, body: string, script = ''): string {
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><style>${BASE_CSS}</style>${THEME_BOOT}</head><body><div class="wrap">${body}</div>${script}</body></html>`;
}
