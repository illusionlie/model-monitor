/**
 * 初始化页(design §4.1):结构沿用原 ui.ts,自动吃到新样式与主题(防 FOUC 脚本在 page() 内)。
 * 客户端脚本内禁用反引号与 "${",字符串一律单引号。
 */
import { page } from './page';

export function renderSetupPage(): string {
  const body = `
<header><h1>📡 模型监视 · 初始化</h1></header>
<div class="card">
  <h2>设置管理密码</h2>
  <p class="muted">设置完成后本页永久关闭。业务密钥(TG token、邮箱等)只存 Cloudflare D1,可稍后在后台再配。</p>
  <form id="f">
    <label>管理密码(≥ 8 位)</label><input type="password" id="password" autocomplete="new-password" required minlength="8">
    <label>确认密码</label><input type="password" id="password2" autocomplete="new-password" required minlength="8">
    <fieldset><legend>Telegram(可选,稍后可改)</legend>
      <label>Bot Token</label><input type="password" id="tg_bot_token" placeholder="123456:ABC-..." autocomplete="off">
      <label>Chat ID</label><input id="tg_chat_id" placeholder="如 123456789" autocomplete="off">
      <div class="chk"><input type="checkbox" id="tg_realtime" checked><span>实时通知</span></div>
    </fieldset>
    <fieldset><legend>邮件(可选,稍后可改)</legend>
      <label>传输方式</label><select id="email_transport"><option value="send_email">send_email(Cloudflare,主力)</option><option value="resend">Resend(后备)</option></select>
      <label>发件地址(需为已验证域)</label><input id="email_from" placeholder="monitor@example.com" autocomplete="off">
      <label>收件地址</label><input id="email_to" placeholder="me@example.com" autocomplete="off">
      <div class="chk"><input type="checkbox" id="email_realtime" checked><span>实时通知</span></div>
    </fieldset>
    <div class="btnrow" style="margin-top:10px"><button class="primary" type="submit">完成初始化</button></div>
    <div class="out" id="out" hidden></div>
  </form>
</div>`;
  const script = `<script>
function $(id){return document.getElementById(id);}
$('f').addEventListener('submit',async function(ev){
  ev.preventDefault();
  var out=$('out');out.hidden=false;out.textContent='提交中…';
  if($('password').value!==$('password2').value){out.textContent='两次密码不一致';return;}
  var body={password:$('password').value};
  var k;
  var map={tg_bot_token:'v',tg_chat_id:'v',email_transport:'v',email_from:'v',email_to:'v'};
  for(k in map){var el=$(k);if(el&&el.value.trim())body[k]=el.value.trim();}
  if($('tg_realtime').checked)body.tg_realtime=true;
  if($('email_realtime').checked)body.email_realtime=true;
  try{
    var res=await fetch('/setup',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
    var j=await res.json().catch(function(){return{};});
    if(!res.ok)throw new Error(j.error||('HTTP '+res.status));
    out.textContent='初始化成功,正在进入后台…';
    location.href='/admin';
  }catch(e){out.textContent='失败:'+e.message;}
});
</script>`;
  return page('初始化 · 模型监视', body, script);
}
