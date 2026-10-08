/**
 * 公开主页(任务 10-08-public-homepage):无鉴权落地页,复用 page() 骨架 + BASE_CSS(自动亮/暗三态)。
 * 信息暴露边界(spec:product/admin-and-feed.md「公开主页」):页面只允许出现三个聚合数字,
 * 源名 / base_url / 模型 ID / 事件内容 / settings 值一律禁止入页(能力简介也不点名具体目录源)。
 * 无页面脚本、无外部资源;home- 前缀 scoped 样式全部走 BASE_CSS 变量体系。
 */
import type { HomeStats } from '../../db/stats';
import { page } from './page';

const HOME_CSS = `<style>
.home-hero{display:block;margin:28px 0 16px;text-align:center}
.home-hero h1{font-size:26px;margin:0 0 4px}
.home-hero p{margin:0}
.home-stats{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;margin-bottom:14px}
.home-stat{margin-bottom:0;padding:18px 8px;text-align:center}
.home-stat strong{display:block;font-size:28px;line-height:1.25;color:var(--accent-strong)}
.home-stat span{font-size:13px;color:var(--fg-soft)}
.home-feats{margin:0;padding-left:18px}
.home-feats li{margin:4px 0}
.home-actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:14px}
.home-actions a{display:inline-block;font:inherit;border:1px solid var(--input-border);background:var(--card);color:var(--fg);border-radius:7px;padding:6px 14px;cursor:pointer;text-decoration:none;transition:background-color .15s,border-color .15s}
.home-actions a:hover{background:var(--hover)}
.home-actions a.home-primary{background:var(--accent);border-color:var(--accent);color:#fff}
.home-actions a.home-primary:hover{background:var(--accent-strong)}
.home-foot{text-align:center;margin:22px 0 8px}
@media (max-width:719.5px){
.home-hero{margin:16px 0 12px}
.home-hero h1{font-size:22px}
.home-stats{grid-template-columns:1fr}
.home-stat{padding:14px 6px}
.home-stat strong{font-size:24px}
}
</style>`;

export function renderHomePage(stats: HomeStats): string {
  const body = `${HOME_CSS}
<header class="home-hero">
  <h1>model-monitor</h1>
  <p class="muted">定时轮询 LLM 模型目录与渠道端点,新增 / 下架及时通知</p>
</header>
<div class="home-stats">
  <div class="card home-stat"><strong>${stats.sourceCount}</strong><span>监控源</span></div>
  <div class="card home-stat"><strong>${stats.modelCount}</strong><span>在架模型</span></div>
  <div class="card home-stat"><strong>${stats.recentEvents}</strong><span>近 24h 变动</span></div>
</div>
<div class="card">
  <h2>这是什么</h2>
  <ul class="home-feats">
    <li>双类监控源:公开模型目录 + 自定义渠道端点</li>
    <li>Telegram 与邮件通知:实时变动 + 每周汇总</li>
    <li>密码保护后台:源管理、事件记录、立即运行</li>
  </ul>
  <div class="home-actions">
    <a class="home-primary" href="/admin">进入后台</a>
    <a href="https://github.com/illusionlie/model-monitor" target="_blank" rel="noopener">GitHub 仓库</a>
  </div>
</div>
<p class="home-foot muted">跑在 Cloudflare Workers 免费档</p>`;
  return page('model-monitor', body);
}
