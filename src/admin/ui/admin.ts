/**
 * 后台单页(design §4.2-§4.6):五标签页(overview/sources/notify/events/security)+ hash 持久 +
 * 主题三态切换 + 渠道编辑 <dialog>(名称/URL/API Key/自定义请求头,行式 Name: value)。
 * 渲染纪律:远端数据一律 DOM API(textContent / .value)填充,禁 innerHTML 插远端字符串。
 * 客户端脚本内禁用反引号与 "${",字符串一律单引号拼接。
 */
import { page } from './page';

export function renderAdminPage(): string {
  const body = `
<header><h1>📡 模型监视 · 后台</h1><div class="btnrow"><button type="button" id="themeBtn" aria-label="主题:跟随系统" title="主题:跟随系统">🌗</button><button type="button" id="logout">登出</button></div></header>

<nav class="tabs" role="tablist" aria-label="后台分区">
<button type="button" role="tab" id="tab-overview" aria-controls="panel-overview" aria-selected="true" class="active">概览</button>
<button type="button" role="tab" id="tab-sources" aria-controls="panel-sources" aria-selected="false">源管理</button>
<button type="button" role="tab" id="tab-notify" aria-controls="panel-notify" aria-selected="false">通知设置</button>
<button type="button" role="tab" id="tab-events" aria-controls="panel-events" aria-selected="false">事件</button>
<button type="button" role="tab" id="tab-security" aria-controls="panel-security" aria-selected="false">安全</button>
</nav>

<section role="tabpanel" id="panel-overview" aria-labelledby="tab-overview">
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
</section>

<section role="tabpanel" id="panel-sources" hidden aria-labelledby="tab-sources">
<div class="card">
  <h2>源管理</h2>
  <div class="tblwrap" id="sourcesBox"><p class="muted">加载中…</p></div>
  <form id="srcForm" style="margin-top:12px">
    <div class="row">
      <div><label>名称</label><input id="srcName" placeholder="如 OpenCode Zen"></div>
      <div style="flex:2"><label>Models 端点(GET {base_url} 须返回 {data:[{id}]})</label><input id="srcUrl" placeholder="https://.../v1/models"></div>
      <div><label>API Key(可选)</label><input type="password" id="srcKey" autocomplete="off"></div>
    </div>
    <details>
      <summary>自定义请求头(可选,点击展开)</summary>
      <label>每行一条,格式 Name: value;# 开头行忽略;优先级高于内置 accept 与 Bearer 鉴权头</label>
      <textarea id="srcHeaders" placeholder="x-api-key: sk-...&#10;# 注释行忽略"></textarea>
    </details>
    <div class="btnrow" style="margin-top:8px"><button type="submit">添加渠道源</button></div>
    <p class="muted">内置目录源(OpenRouter / models.dev)不可删除,只可启停。新源首轮静默 seed:仅发一条接入确认。「清理模型」可清空某源存量并复位为静默接入状态(源配置与事件记录保留)。</p>
  </form>
</div>
</section>

<section role="tabpanel" id="panel-notify" hidden aria-labelledby="tab-notify">
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
</section>

<section role="tabpanel" id="panel-events" hidden aria-labelledby="tab-events">
<div class="card">
  <h2>最近事件(50)</h2>
  <div class="tblwrap" id="eventsBox"><p class="muted">加载中…</p></div>
</div>
</section>

<section role="tabpanel" id="panel-security" hidden aria-labelledby="tab-security">
<div class="card">
  <h2>修改管理密码</h2>
  <form id="pwForm" class="row" style="align-items:flex-end">
    <div><label>新密码(≥ 8 位)</label><input type="password" id="new_password" autocomplete="new-password" minlength="8"></div>
    <button class="primary" type="submit">更新密码</button>
  </form>
  <p class="muted" style="margin-top:8px">更新会重新生成会话签名密钥:其他设备的登录全部失效,当前浏览器自动续期。</p>
  <div class="out" id="pwOut" hidden></div>
</div>
</section>

<dialog id="editDlg" aria-labelledby="editDlgTitle">
  <h2 id="editDlgTitle" style="margin:0 0 10px">编辑渠道源</h2>
  <form id="editForm">
    <label>名称</label><input id="edName" autocomplete="off">
    <label>Models 端点(GET {base_url} 须返回 {data:[{id}]})</label><input id="edUrl" autocomplete="off">
    <label>API Key</label><input type="password" id="edKey" autocomplete="off" placeholder="留空 = 不修改">
    <div class="chk"><input type="checkbox" id="edKeyClear"><span>清空 API Key</span></div>
    <label>自定义请求头(每行一条,格式 Name: value;# 开头行忽略;优先级高于内置 accept 与 Bearer 鉴权头)</label>
    <textarea id="edHeaders" placeholder="x-api-key: sk-...&#10;# 注释行忽略"></textarea>
    <div class="chk"><input type="checkbox" id="edHeadersClear"><span>清空全部自定义请求头</span></div>
    <div class="btnrow" style="margin-top:10px"><button type="button" id="edCancel">取消</button><button class="primary" type="submit">保存</button></div>
  </form>
</dialog>`;

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

// ---- 标签页(hash 持久 + panelIn 进入动画) ----
var TABS=['overview','sources','notify','events','security'];
function showTab(id){
  if(TABS.indexOf(id)<0)id='overview';
  TABS.forEach(function(t){
    var on=t===id,b=$('tab-'+t),p=$('panel-'+t);
    b.classList.toggle('active',on);
    b.setAttribute('aria-selected',on?'true':'false');
    if(on&&p.hidden){p.hidden=false;p.classList.remove('enter');void p.offsetWidth;p.classList.add('enter');}
    if(!on)p.hidden=true;
  });
  history.replaceState(null,'','#tab-'+id);
}
TABS.forEach(function(t){
  $('tab-'+t).addEventListener('click',function(){showTab(t);});
  $('panel-'+t).addEventListener('animationend',function(e){if(e.animationName==='panelIn')e.target.classList.remove('enter');});
});
showTab((location.hash||'').replace('#tab-',''));

// ---- 主题三态(auto/light/dark 循环;auto 交还系统) ----
var THEME_ORDER=['auto','light','dark'];
var THEME_ICON={auto:'🌗',light:'☀️',dark:'🌙'};
var THEME_LABEL={auto:'跟随系统',light:'亮色',dark:'暗色'};
function themeMode(){
  try{var v=localStorage.getItem('mm_theme');if(v==='light'||v==='dark')return v;}catch(e){}
  return 'auto';
}
function applyTheme(mode){
  if(mode==='light'||mode==='dark')document.documentElement.dataset.theme=mode;
  else document.documentElement.removeAttribute('data-theme');
  var label='主题:'+THEME_LABEL[mode];
  var b=$('themeBtn');b.textContent=THEME_ICON[mode];b.setAttribute('aria-label',label);b.title=label;
}
$('themeBtn').addEventListener('click',function(){
  var next=THEME_ORDER[(THEME_ORDER.indexOf(themeMode())+1)%THEME_ORDER.length];
  try{
    if(next==='auto')localStorage.removeItem('mm_theme');
    else localStorage.setItem('mm_theme',next);
  }catch(e){}
  applyTheme(next);
});
applyTheme(themeMode());

// ---- 自定义请求头行式文本(每行 Name: value;首个 ':' 前为名后为值;空行与 '#' 开头行跳过) ----
function headersToText(map){
  if(!map)return '';
  var lines=[];
  for(var k in map)lines.push(k+': '+map[k]);
  return lines.join('\\n');
}
function parseHeaderText(text){
  var out={},lines=String(text||'').split('\\n');
  for(var i=0;i<lines.length;i++){
    var line=lines[i].trim();
    if(!line||line.charAt(0)==='#')continue;
    var idx=line.indexOf(':');
    if(idx<=0)return null;
    var name=line.slice(0,idx).trim();
    if(!name)return null;
    out[name]=line.slice(idx+1).trim();
  }
  return out;
}

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
    op.appendChild(document.createTextNode(' '));
    var rst=el('button',null,'清理模型');
    rst.addEventListener('click',function(){resetSource(src);});
    op.appendChild(rst);
    if(src.kind==='channel'){
      op.appendChild(document.createTextNode(' '));
      var ed=el('button',null,'编辑');
      ed.addEventListener('click',function(){openEdit(src);});
      op.appendChild(ed);
      op.appendChild(document.createTextNode(' '));
      var del=el('button','danger','删除');
      del.addEventListener('click',function(){delSource(src);});
      op.appendChild(del);
    }
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
async function resetSource(src){
  if(!confirm('清理「'+src.name+'」的已存模型?下轮探测将按新源静默重新接入(仅一条确认通知)。'))return;
  try{await api('/admin/api/sources/'+src.id+'/reset','POST');await loadState();}
  catch(e){alert('清理失败:'+e.message);}
}
// ---- 渠道编辑 dialog(一个 dialog 复用,预填走 .value) ----
var editing=null;
function openEdit(src){
  editing=src;
  $('edName').value=src.name;
  $('edUrl').value=src.base_url;
  $('edKey').value='';
  $('edKey').placeholder=src.has_api_key?'已配置,留空 = 不修改':'未配置';
  $('edKeyClear').checked=false;
  $('edHeaders').value=headersToText(src.extra_headers);
  $('edHeadersClear').checked=false;
  $('editDlg').showModal();
}
$('edCancel').addEventListener('click',function(){$('editDlg').close();});
$('editForm').addEventListener('submit',async function(ev){
  ev.preventDefault();
  if(!editing)return;
  var body={name:$('edName').value.trim(),base_url:$('edUrl').value.trim()};
  if(!body.name||!/^https?:\\/\\//.test(body.base_url)){alert('名称必填,端点须为 http(s) URL。');return;}
  var keyVal=$('edKey').value.trim();
  if($('edKeyClear').checked){
    body.api_key=null;
    if(keyVal)alert('已同时填写新 API Key 与勾选「清空 API Key」:将以清空为准。');
  }else if(keyVal){
    body.api_key=keyVal;
  }
  if($('edHeadersClear').checked){
    body.extra_headers=null;
  }else{
    var parsed=parseHeaderText($('edHeaders').value);
    if(!parsed){alert('自定义请求头格式错误:每行需为 Name: value(首个冒号前为名称)。');return;}
    body.extra_headers=parsed;
  }
  try{
    await api('/admin/api/sources/'+editing.id,'PATCH',body);
    $('editDlg').close();
    await loadState();
  }catch(e){alert('保存失败:'+e.message);}
});
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
  var headers=parseHeaderText($('srcHeaders').value);
  if(!headers){alert('自定义请求头格式错误:每行需为 Name: value(首个冒号前为名称)。');return;}
  var body={name:$('srcName').value.trim(),base_url:$('srcUrl').value.trim(),extra_headers:headers};
  if($('srcKey').value.trim())body.api_key=$('srcKey').value.trim();
  try{
    await api('/admin/api/sources','POST',body);
    $('srcName').value='';$('srcUrl').value='';$('srcKey').value='';$('srcHeaders').value='';
    await loadState();
  }catch(e){alert('添加失败:'+e.message);}
});
loadState().catch(function(e){showOut('opsOut','状态加载失败:'+e.message);});
</script>`;
  return page('后台 · 模型监视', body, script);
}
