/**
 * 登录页(design §4.1):结构沿用原 ui.ts,自动吃到新样式与主题(防 FOUC 脚本在 page() 内)。
 * 客户端脚本内禁用反引号与 "${",字符串一律单引号。
 */
import { page } from './page';

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
