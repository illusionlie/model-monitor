/**
 * 后台基础样式(design §4.2-§4.5):CSS 变量主题(亮默认;暗色两路——auto 跟随 prefers-color-scheme、
 * data-theme 显式覆盖)、tabs 下划线指示条、panelIn/dialogIn 动画、720px 响应式、prefers-reduced-motion 兜底。
 * 暗色变量单源(DARK_VARS),由 auto 媒体查询与 data-theme="dark" 两处引用,避免两份手抄漂移。
 */

const LIGHT_VARS =
  'color-scheme:light;--bg:#f4f5f7;--fg:#1c1e21;--fg-soft:#555;--muted:#8a8f98;--hover:#f0f2f5;--card:#fff;--border:#e3e5e8;--input-bg:#fff;--input-border:#c9ccd1;--accent:#2563eb;--accent-strong:#1d4fd7;--focus-ring:rgba(37,99,235,.15);--danger:#b3261e;--danger-border:#d8a09b;--ok:#0a7d32;--err:#b3261e;--out-bg:#0f172a;--out-fg:#d7e3ff;--code-bg:#eef0f3;--backdrop:rgba(15,17,21,.45);--tag-added:#0a7d32;--tag-delisted:#b3261e;--tag-seed:#5567c2;--tag-fail:#b3691e;--tag-recovered:#0e7490';

const DARK_VARS =
  'color-scheme:dark;--bg:#101216;--fg:#e4e6ea;--fg-soft:#b3b9c3;--muted:#9aa0aa;--hover:#232830;--card:#171a20;--border:#2a2f37;--input-bg:#1d222a;--input-border:#3b424c;--accent:#3b82f6;--accent-strong:#60a5fa;--focus-ring:rgba(59,130,246,.22);--danger:#f87171;--danger-border:#8a3d3d;--ok:#4ade80;--err:#f87171;--out-bg:#0b0f16;--out-fg:#c3d2f0;--code-bg:#232830;--backdrop:rgba(0,0,0,.6);--tag-added:#15803d;--tag-delisted:#dc2626;--tag-seed:#6366f1;--tag-fail:#d97706;--tag-recovered:#0891b2';

export const BASE_CSS = `
:root{${LIGHT_VARS}}
@media (prefers-color-scheme: dark){html:not([data-theme]){${DARK_VARS}}}
html[data-theme="dark"]{${DARK_VARS}}
*{box-sizing:border-box}
body{font-family:-apple-system,system-ui,"Segoe UI",Roboto,"PingFang SC","Microsoft YaHei",sans-serif;margin:0;background:var(--bg);color:var(--fg);font-size:14px;line-height:1.55}
.wrap{max-width:860px;margin:0 auto;padding:16px}
header{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:12px}
h1{font-size:18px;margin:0}
h2{font-size:15px;margin:0 0 10px}
body,.card,input,select,textarea,button,fieldset,.out,dialog{transition:background-color .2s,color .2s,border-color .2s}
.card{background:var(--card);border:1px solid var(--border);border-radius:10px;padding:14px 16px;margin-bottom:14px}
.tabs{display:flex;gap:2px;border-bottom:1px solid var(--border);margin-bottom:14px;overflow-x:auto;scrollbar-width:none;scroll-padding:0 16px}
.tabs::-webkit-scrollbar{display:none}
.tabs button{position:relative;border:none;background:transparent;color:var(--muted);padding:8px 14px;border-radius:7px 7px 0 0;white-space:nowrap;transition:color .2s}
.tabs button:hover{background:transparent;color:var(--fg)}
.tabs button.active{color:var(--accent-strong)}
.tabs button::after{content:'';position:absolute;left:10px;right:10px;bottom:-1px;height:2px;background:var(--accent);border-radius:1px;transform:scaleX(0);transform-origin:left center;transition:transform .2s}
.tabs button.active::after{transform:scaleX(1)}
button{font:inherit;border:1px solid var(--input-border);background:var(--card);color:var(--fg);border-radius:7px;padding:6px 12px;cursor:pointer;transition:background-color .15s,border-color .15s,transform .15s}
button:hover{background:var(--hover)}
button:active{transform:scale(.98)}
button.primary{background:var(--accent);border-color:var(--accent);color:#fff}
button.primary:hover{background:var(--accent-strong)}
button.danger{color:var(--danger);border-color:var(--danger-border)}
button:disabled{opacity:.5;cursor:default}
input,select,textarea{font:inherit;width:100%;padding:7px 9px;border:1px solid var(--input-border);border-radius:7px;background:var(--input-bg);color:var(--fg)}
input:focus,select:focus,textarea:focus{border-color:var(--accent);outline:none;box-shadow:0 0 0 3px var(--focus-ring)}
textarea{min-height:64px;resize:vertical}
label{display:block;font-size:13px;color:var(--fg-soft);margin:8px 0 3px}
.chk{display:flex;align-items:center;gap:6px;margin:6px 0;font-size:13px;color:var(--fg-soft)}
.chk input{width:auto}
.row{display:flex;gap:8px;flex-wrap:wrap}
.row>*{flex:1;min-width:140px}
fieldset{border:1px solid var(--border);border-radius:8px;margin:0 0 10px;padding:8px 12px 10px}
legend{font-size:13px;color:var(--accent);padding:0 4px}
.btnrow{display:flex;gap:8px;flex-wrap:wrap}
details{margin-top:6px}
summary{cursor:pointer;font-size:13px;color:var(--fg-soft);margin:8px 0 3px}
.tblwrap{overflow-x:auto}
table{border-collapse:collapse;width:100%;font-size:13px}
th,td{padding:6px 8px;border-bottom:1px solid var(--border);text-align:left;vertical-align:top;white-space:nowrap}
th{color:var(--fg-soft);font-weight:600}
td.wrap,th.wrap{white-space:normal}
.muted{color:var(--muted);font-size:12px}
.out{background:var(--out-bg);color:var(--out-fg);border-radius:8px;padding:10px;font-size:12px;white-space:pre-wrap;word-break:break-all;margin-top:10px}
.tag{display:inline-block;border-radius:9px;padding:0 8px;font-size:12px;color:#fff}
.t-added{background:var(--tag-added)}.t-delisted{background:var(--tag-delisted)}.t-seed{background:var(--tag-seed)}.t-source_fail{background:var(--tag-fail)}.t-source_recovered{background:var(--tag-recovered)}.t-notify_fail{background:var(--tag-fail)}
.ok{color:var(--ok)}.err{color:var(--err)}
code{background:var(--code-bg);padding:1px 5px;border-radius:4px;font-size:12px;word-break:break-all}
dialog{border:1px solid var(--border);border-radius:10px;background:var(--card);color:var(--fg);padding:16px;max-width:480px;width:min(480px,calc(100vw - 32px));box-shadow:0 12px 32px rgba(0,0,0,.18)}
dialog::backdrop{background:var(--backdrop)}
dialog[open]{animation:dialogIn .18s ease-out}
@keyframes dialogIn{from{opacity:0;transform:scale(.96)}to{opacity:1;transform:scale(1)}}
section[role=tabpanel].enter{animation:panelIn .18s ease-out}
@keyframes panelIn{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:translateY(0)}}
@media (max-width:719.5px){
.wrap{padding:12px}
header{flex-wrap:wrap}
.tabs button{padding:8px 10px}
.row{flex-direction:column}
.row>*{min-width:0}
fieldset{padding:6px 10px 8px}
}
@media (prefers-reduced-motion: reduce){
*,*::before,*::after{animation-duration:0s!important;transition-duration:0s!important;transition-delay:0s!important}
}
`;
