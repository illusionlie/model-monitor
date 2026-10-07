import { describe, expect, it } from 'vitest';
import { renderAdminPage, renderLoginPage, renderSetupPage } from '../src/admin/ui';

/** 提取 HTML 里全部 <script> 内联段(防 FOUC 主题脚本 + 页面脚本) */
function scriptsOf(html: string): string[] {
  return html
    .split('<script>')
    .slice(1)
    .map((s) => s.slice(0, s.indexOf('</script>')));
}

describe('后台 UI 骨架(design §4,纯字符串断言)', () => {
  const admin = renderAdminPage();

  it('五标签页:tab/panel id 一一对应,各 5 个', () => {
    for (const id of ['overview', 'sources', 'notify', 'events', 'security']) {
      expect(admin).toContain(`id="tab-${id}"`);
      expect(admin).toContain(`id="panel-${id}"`);
      expect(admin).toContain(`aria-controls="panel-${id}"`);
    }
    expect(admin.match(/role="tab"/g)).toHaveLength(5);
    expect(admin.match(/role="tabpanel"/g)).toHaveLength(5);
  });

  it('hash 持久与面板动画逻辑片段', () => {
    expect(admin).toContain("history.replaceState(null,'','#tab-'");
    expect(admin).toContain("location.hash");
    expect(admin).toContain('@keyframes panelIn');
    expect(admin).toContain("@keyframes dialogIn");
  });

  it('防 FOUC 主题脚本与三态变量体系(所有页面共享)', () => {
    for (const html of [admin, renderLoginPage(), renderSetupPage()]) {
      expect(html).toContain("localStorage.getItem('mm_theme')");
      expect(html).toContain('document.documentElement.dataset.theme');
      expect(html).toContain('prefers-color-scheme: dark');
      expect(html).toContain('html:not([data-theme])');
      expect(html).toContain('html[data-theme="dark"]');
      expect(html).toContain('color-scheme:light');
      expect(html).toContain('color-scheme:dark');
    }
  });

  it('reduced-motion 兜底与响应式断点', () => {
    expect(admin).toContain('@media (prefers-reduced-motion');
    expect(admin).toContain('@media (max-width:719.5px)');
  });

  it('渠道编辑 dialog 与请求头行式解析', () => {
    expect(admin).toContain('<dialog id="editDlg"');
    expect(admin).toContain('id="edName"');
    expect(admin).toContain('id="edKeyClear"');
    expect(admin).toContain('id="edHeadersClear"');
    expect(admin).toContain('function parseHeaderText');
    expect(admin).toContain('function headersToText');
  });

  it('客户端脚本内禁用反引号与 "${"(TS 模板冲突防护)', () => {
    for (const html of [admin, renderLoginPage(), renderSetupPage()]) {
      const scripts = scriptsOf(html);
      expect(scripts.length).toBeGreaterThan(0);
      for (const s of scripts) {
        expect(s).not.toContain('`');
        expect(s).not.toContain('${');
      }
    }
  });
});
