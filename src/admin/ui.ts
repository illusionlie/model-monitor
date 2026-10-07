/**
 * 后台页面(design §1/§9):服务端拼 HTML 字符串 + 内联 CSS + 少量 vanilla JS(fetch 调 admin API)。
 * 单 admin 页搞定全部管理;移动端可用(响应式 + 表格横向滚动)。
 * 客户端 JS 全程用 DOM API(textContent)渲染远端数据,防注入;不引入任何构建步骤。
 * 注意:客户端脚本内禁用反引号与 "${",避免与 TS 模板字面量冲突。
 */

const BASE_CSS = `
:root{color-scheme:light}
*{box-sizing:border-box}
body{font-family:-apple-system,system-ui,"Segoe UI",Roboto,"PingFang SC","Microsoft YaHei",sans-serif;margin:0;background:#f4f5f7;color:#1c1e21;font-size:14px;line-height:1.55}
.wrap{max-width:860px;margin:0 auto;padding:16px}
header{display:flex;align-items:center;justify-content:space-between;margin-bottom:12px}
h1{font-size:18px;margin:0}
h2{font-size:15px;margin:0 0 10px}
.card{background:#fff;border:1px solid #e3e5e8;border-radius:10px;padding:14px 16px;margin-bottom:14px}
button{font:inherit;border:1px solid #c9ccd1;background:#fff;border-radius:7px;padding:6px 12px;cursor:pointer}
button:hover{background:#f0f2f5}
button.primary{background:#2563eb;border-color:#2563eb;color:#fff}
button.primary:hover{background:#1d4fd7}
button.danger{color:#b3261e;border-color:#d8a09b}
button:disabled{opacity:.5;cursor:default}
input,select,textarea{font:inherit;width:100%;padding:7px 9px;border:1px solid #c9ccd1;border-radius:7px;background:#fff}
textarea{min-height:64px;resize:vertical}
label{display:block;font-size:13px;color:#555;margin:8px 0 3px}
.chk{display:flex;align-items:center;gap:6px;margin:6px 0;font-size:13px;color:#333}
.chk input{width:auto}
.row{display:flex;gap:8px;flex-wrap:wrap}
.row>*{flex:1;min-width:140px}
fieldset{border:1px solid #e3e5e8;border-radius:8px;margin:0 0 10px;padding:8px 12px 10px}
legend{font-size:13px;color:#2563eb;padding:0 4px}
.btnrow{display:flex;gap:8px;flex-wrap:wrap}
.tblwrap{overflow-x:auto}
table{border-collapse:collapse;width:100%;font-size:13px}
th,td{padding:6px 8px;border-bottom:1px solid #eceef0;text-align:left;vertical-align:top;white-space:nowrap}
th{color:#666;font-weight:600}
td.wrap,th.wrap{white-space:normal}
.muted{color:#8a8f98;font-size:12px}
.out{background:#0f172a;color:#d7e3ff;border-radius:8px;padding:10px;font-size:12px;white-space:pre-wrap;word-break:break-all;margin-top:10px}
.tag{display:inline-block;border-radius:9px;padding:0 8px;font-size:12px;color:#fff}
.t-added{background:#0a7d32}.t-delisted{background:#b3261e}.t-seed{background:#5567c2}.t-source_fail{background:#b3691e}.t-source_recovered{background:#0e7490}
.ok{color:#0a7d32}.err{color:#b3261e}
code{background:#eef0f3;padding:1px 5px;border-radius:4px;font-size:12px;word-break:break-all}
`;

function page(title: string, body: string, script = ''): string {
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><style>${BASE_CSS}</style></head><body><div class="wrap">${body}</div>${script}</body></html>`;
}

// ---------- setup ----------

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

// ---------- login ----------

export function renderLoginPage(): string {
  const body = `
<header><h1>📡 模型监视 · 登录</h1></header>
<div class="card" style="max-width:420px;margin:40px auto">
  <form id="f">
    <label>管理密码</label><input type="password" id="password" autocomplete="current-password" required autofocus>
    <div class="btnrow" style="margin-top:10px"><button class="primary" type="submit" style="width:100%">登录</button></div>
    <div class="out" id="out" hidden></div>
  </form>
</div>`;
  const script = `<script>
function $(id){return document.getElementById(id);}
$('f').addEventListener('submit',async function(ev){
  ev.preventDefault();
  var out=$('out');out.hidden=false;out.textContent='验证中…';
  try{
    var res=await fetch('/admin/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({password:$('password').value})});
    var j=await res.json().catch(function(){return{};});
    if(!res.ok)throw new Error(j.error||'密码错误');
    location.href='/admin';
  }catch(e){out.textContent='失败:'+e.message;}
});
</script>`;
  return page('登录 · 模型监视', body, script);
}

// ---------- admin(单页) ----------

export function renderAdminPage(): string {
  const body = `
<header><h1>📡 模型监视 · 后台</h1><button id="logout">登出</button></header>

<div class="card">
  <h2>操作</h2>
  <div class="btnrow">
    <button class="primary" id="run">▶ 立即运行</button>
    <button id="test">🧪 发送测试通知</button>
    <button id="rotate">🔄 轮换 Feed Secret</button>
  </div>
  <div class="out" id="opsOut" hidden></div>
  <p class="muted" style="margin-top:10px">Feed 读取:<code>GET /feed</code>,请求头 <code>X-Feed-Secret: <span id="feedSecret" class="mono">-</span></code>(时间倒序 100 条事件 + 每源统计)</p>
</div>

<div class="card">
  <h2>通知与监控设置</h2>
  <form id="notifyForm">
    <fieldset><legend>Telegram</legend>
      <label>Bot Token(已配置时留空 = 不修改)</label><input type="password" id="tg_bot_token" placeholder="留空保持不变" autocomplete="off">
      <label>Chat ID</label><input id="tg_chat_id" autocomplete="off">
      <div class="row">
        <div class="chk"><input type="checkbox" id="tg_realtime"><span>实时事件</span></div>
        <div class="chk"><input type="checkbox" id="tg_weekly"><span>周报(每周五 21:00 北京)</span></div>
      </div>
    </fieldset>
    <fieldset><legend>邮件</legend>
      <label>传输方式</label><select id="email_transport"><option value="send_email">send_email(Cloudflare,主力)</option><option value="resend">Resend(后备)</option></select>
      <label>发件地址(需为已验证域)</label><input id="email_from" autocomplete="off">
      <label>收件地址</label><input id="email_to" autocomplete="off">
      <label>Resend API Key(transport=Resend 时需要;留空 = 不修改)</label><input type="password" id="resend_api_key" autocomplete="off">
      <div class="row">
        <div class="chk"><input type="checkbox" id="email_realtime"><span>实时事件</span></div>
        <div class="chk"><input type="checkbox" id="email_weekly"><span>周报</span></div>
      </div>
    </fieldset>
    <fieldset><legend>事件开关</legend>
      <div class="row">
        <div class="chk"><input type="checkbox" id="event_added_enabled"><span>新增事件(added)</span></div>
        <div class="chk"><input type="checkbox" id="event_delisted_enabled"><span>下架事件(delisted)</span></div>
      </div>
      <p class="muted">失败告警固定走 TG 实时通道(spec:product/notifications.md),不受上表影响。</p>
    </fieldset>
    <fieldset><legend>allowlist(目录源 provider 白名单,仅 OpenRouter / models.dev 生效)</legend>
      <textarea id="allowlist" placeholder="每行一个或逗号分隔,如:&#10;openai&#10;anthropic&#10;留空 = 全量"></textarea>
      <p class="muted">修改后所有目录源下轮静默全量重建(不产生事件,不通知)。</p>
    </fieldset>
    <div class="btnrow"><button class="primary" type="submit">保存设置</button></div>
    <div class="out" id="notifyOut" hidden></div>
  </form>
</div>

<div class="card">
  <h2>修改管理密码</h2>
  <form id="pwForm" class="row" style="align-items:flex-end">
    <div><label>新密码(≥ 8 位)</label><input type="password" id="new_password" autocomplete="new-password" minlength="8"></div>
    <button class="primary" type="submit">更新密码</button>
  </form>
  <p class="muted" style="margin-top:8px">更新会重新生成会话签名密钥:其他设备的登录全部失效,当前浏览器自动续期。</p>
  <div class="out" id="pwOut" hidden></div>
</div>

<div class="card">
  <h2>源管理</h2>
  <div class="tblwrap" id="sourcesBox"><p class="muted">加载中…</p></div>
  <form id="srcForm" style="margin-top:12px">
    <div class="row">
      <div><label>名称</label><input id="srcName" placeholder="如 OpenCode Zen"></div>
      <div style="flex:2"><label>Models 端点(GET {base_url} 须返回 {data:[{id}]})</label><input id="srcUrl" placeholder="https://.../v1/models"></div>
      <div><label>API Key(可选)</label><input type="password" id="srcKey" autocomplete="off"></div>
    </div>
    <div class="btnrow" style="margin-top:8px"><button type="submit">添加渠道源</button></div>
    <p class="muted">内置目录源(OpenRouter / models.dev)不可删除,只可启停。新源首轮静默 seed:仅发一条接入确认。</p>
  </form>
</div>

<div class="card">
  <h2>最近事件(50)</h2>
  <div class="tblwrap" id="eventsBox"><p class="muted">加载中…</p></div>
</div>`;

  const script = `<script>
var S=null;
function $(id){return document.getElementById(id);}
async function api(path,method,body){
  var opt={method:method||'GET',headers:{}};
  if(body!==undefined){opt.headers['content-type']='application/json';opt.body=JSON.stringify(body);}
  var res=await fetch(path,opt);
  if(res.status===401){location.href='/admin';throw new Error('未登录');}
  var j=null;try{j=await res.json();}catch(e){}
  if(!res.ok)throw new Error((j&&j.error)||('HTTP '+res.status));
  return j;
}
function el(tag,cls,text){var n=document.createElement(tag);if(cls)n.className=cls;if(text!==undefined&&text!==null)n.textContent=text;return n;}
function fmtParts(d,tz){
  var f=new Intl.DateTimeFormat('en-CA',{timeZone:tz,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false});
  var p={};f.formatToParts(d).forEach(function(x){p[x.type]=x.value;});
  if(p.hour==='24')p.hour='00';
  return p.year+'-'+p.month+'-'+p.day+' '+p.hour+':'+p.minute;
}
function fmtDual(iso){try{var d=new Date(iso);return '北京 '+fmtParts(d,'Asia/Shanghai')+' (UTC '+fmtParts(d,'UTC')+')';}catch(e){return iso;}}
var KINDS={added:['新增','t-added'],delisted:['下架','t-delisted'],seed:['接入','t-seed'],source_fail:['失败','t-source_fail'],source_recovered:['恢复','t-source_recovered']};
function showOut(id,text){var o=$(id);o.hidden=false;o.textContent=text;}

function fillNotify(){
  var s=S.settings;
  $('tg_chat_id').value=s.tg_chat_id||'';
  $('tg_realtime').checked=!!s.tg_realtime;$('tg_weekly').checked=!!s.tg_weekly;
  $('email_transport').value=s.email_transport||'send_email';
  $('email_from').value=s.email_from||'';$('email_to').value=s.email_to||'';
  $('email_realtime').checked=!!s.email_realtime;$('email_weekly').checked=!!s.email_weekly;
  $('event_added_enabled').checked=!!s.event_added_enabled;$('event_delisted_enabled').checked=!!s.event_delisted_enabled;
  $('allowlist').value=(s.allowlist||[]).join('\\n');
  $('tg_bot_token').placeholder=s.has_tg_bot_token?'已配置,留空 = 不修改':'123456:ABC-...';
  $('resend_api_key').placeholder=s.has_resend_api_key?'已配置,留空 = 不修改':'re_...';
  $('feedSecret').textContent=s.feed_secret||'(未生成)';
}
function renderSources(){
  var box=$('sourcesBox');box.textContent='';
  var t=el('table');var thead=el('thead');var hr=el('tr');
  ['ID','名称','类型','状态','模型数','最近成功','最近错误','操作'].forEach(function(h){hr.appendChild(el('th',null,h));});
  thead.appendChild(hr);t.appendChild(thead);var tb=el('tbody');
  S.sources.forEach(function(src){
    var tr=el('tr');
    tr.appendChild(el('td',null,String(src.id)));
    tr.appendChild(el('td',null,src.name));
    tr.appendChild(el('td',null,src.kind==='catalog'?'目录':'渠道'));
    var st=el('td');st.appendChild(el('span','tag '+(src.enabled?'t-added':'t-delisted'),src.enabled?'启用':'停用'));tr.appendChild(st);
    tr.appendChild(el('td',null,String(src.model_count)));
    tr.appendChild(el('td',null,src.last_success?fmtDual(src.last_success):'-'));
    tr.appendChild(el('td','wrap',src.last_error||'-'));
    var op=el('td');
    var tg=el('button',null,src.enabled?'停用':'启用');
    tg.addEventListener('click',function(){toggleSource(src);});
    op.appendChild(tg);
    if(src.kind==='channel'){op.appendChild(document.createTextNode(' '));
      var del=el('button','danger','删除');
      del.addEventListener('click',function(){delSource(src);});
      op.appendChild(del);}
    tr.appendChild(op);tb.appendChild(tr);
  });
  t.appendChild(tb);box.appendChild(t);
}
function renderEvents(){
  var box=$('eventsBox');box.textContent='';
  if(!S.events.length){box.appendChild(el('p','muted','暂无事件。点「立即运行」跑一轮。'));return;}
  var t=el('table');var thead=el('thead');var hr=el('tr');
  ['时间','源','类型','模型','备注'].forEach(function(h){hr.appendChild(el('th',null,h));});
  thead.appendChild(hr);t.appendChild(thead);var tb=el('tbody');
  S.events.forEach(function(ev){
    var tr=el('tr');
    tr.appendChild(el('td',null,fmtDual(ev.detected_at)));
    tr.appendChild(el('td',null,ev.source_name));
    var k=KINDS[ev.kind]||[ev.kind,''];var kd=el('td');kd.appendChild(el('span','tag '+k[1],k[0]));tr.appendChild(kd);
    tr.appendChild(el('td','wrap',(ev.model_id||'-')));
    var note=ev.suppressed?'已静默(目录组去重)':(ev.notified?'已通知':'未通知');
    tr.appendChild(el('td','muted',note));
    tb.appendChild(tr);
  });
  t.appendChild(tb);box.appendChild(t);
}
async function loadState(){
  S=await api('/admin/api/state');
  fillNotify();renderSources();renderEvents();
}
async function toggleSource(src){
  try{await api('/admin/api/sources/'+src.id,'PATCH',{enabled:!src.enabled});await loadState();}
  catch(e){alert('操作失败:'+e.message);}
}
async function delSource(src){
  if(!confirm('确认删除渠道源「'+src.name+'」?其模型与事件记录将一并删除。'))return;
  try{await api('/admin/api/sources/'+src.id,'DELETE');await loadState();}
  catch(e){alert('删除失败:'+e.message);}
}
$('logout').addEventListener('click',async function(){try{await api('/admin/logout','POST');}catch(e){}location.href='/admin';});
$('run').addEventListener('click',async function(){
  showOut('opsOut','运行中(每源最多 15s 超时)…');
  try{
    var j=await api('/admin/api/run','POST');
    var lines=j.summary.sources.map(function(s){return s.sourceName+': '+s.outcome+(s.error?('('+s.error+')'):'');});
    showOut('opsOut','完成。事件入库 '+j.summary.eventsInserted+' 条;周报 '+(j.summary.weeklySent||'未触发')+'\\n'+lines.join('\\n'));
    await loadState();
  }catch(e){showOut('opsOut','失败:'+e.message);}
});
$('test').addEventListener('click',async function(){
  showOut('opsOut','发送中…');
  try{
    var j=await api('/admin/api/test-notify','POST');
    showOut('opsOut','Telegram: '+j.telegram+'\\nEmail: '+j.email);
  }catch(e){showOut('opsOut','失败:'+e.message);}
});
$('rotate').addEventListener('click',async function(){
  if(!confirm('轮换后旧 Feed Secret 立即失效,确认?'))return;
  try{var j=await api('/admin/api/feed-secret','POST');$('feedSecret').textContent=j.feed_secret;showOut('opsOut','已轮换。');}
  catch(e){showOut('opsOut','失败:'+e.message);}
});
$('notifyForm').addEventListener('submit',async function(ev){
  ev.preventDefault();
  var body={
    tg_chat_id:$('tg_chat_id').value.trim(),
    email_transport:$('email_transport').value,
    email_from:$('email_from').value.trim(),
    email_to:$('email_to').value.trim(),
    tg_realtime:$('tg_realtime').checked,tg_weekly:$('tg_weekly').checked,
    email_realtime:$('email_realtime').checked,email_weekly:$('email_weekly').checked,
    event_added_enabled:$('event_added_enabled').checked,event_delisted_enabled:$('event_delisted_enabled').checked,
    allowlist:$('allowlist').value
  };
  if($('tg_bot_token').value.trim())body.tg_bot_token=$('tg_bot_token').value.trim();
  if($('resend_api_key').value.trim())body.resend_api_key=$('resend_api_key').value.trim();
  showOut('notifyOut','保存中…');
  try{
    var j=await api('/admin/api/settings','PUT',body);
    showOut('notifyOut','已保存。'+(j.rebaseline?'allowlist 变更:目录源下轮将静默全量重建。':''));
    await loadState();
  }catch(e){showOut('notifyOut','失败:'+e.message);}
});
$('pwForm').addEventListener('submit',async function(ev){
  ev.preventDefault();
  var pw=$('new_password').value;
  if(pw.length<8){showOut('pwOut','密码至少 8 位。');return;}
  showOut('pwOut','更新中…');
  try{await api('/admin/api/settings','PUT',{new_password:pw});showOut('pwOut','已更新,当前会话已自动续期。');$('new_password').value='';}
  catch(e){showOut('pwOut','失败:'+e.message);}
});
$('srcForm').addEventListener('submit',async function(ev){
  ev.preventDefault();
  try{
    await api('/admin/api/sources','POST',{name:$('srcName').value.trim(),base_url:$('srcUrl').value.trim(),api_key:$('srcKey').value.trim()||undefined});
    $('srcName').value='';$('srcUrl').value='';$('srcKey').value='';
    await loadState();
  }catch(e){alert('添加失败:'+e.message);}
});
loadState().catch(function(e){showOut('opsOut','状态加载失败:'+e.message);});
</script>`;
  return page('后台 · 模型监视', body, script);
}
