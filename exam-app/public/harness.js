const $=id=>document.getElementById(id),esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let token,defaults,report,running=false,polling=false,lastRender='';
async function api(path,data){const r=await fetch(`/api/${path}`,data===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json','X-Exam-Token':token},body:JSON.stringify(data)});const result=await r.json();if(!r.ok)throw new Error(result.error??'요청 실패');return result;}
function error(message){$('toast').textContent=message;$('toast').classList.remove('hidden');setTimeout(()=>$('toast').classList.add('hidden'),6000);}
function render(){
  $('runHarness').disabled=running;$('cancelHarness').classList.toggle('hidden',!running);$('downloadReport').disabled=!report;
  for(const id of ['runMode','inputTokens','outputTokens','repeats','cases','resetCases'])$(id).disabled=running;
  if(!report)return;
  const key=JSON.stringify(report);if(key===lastRender)return;lastRender=key;
  $('harnessStatus').textContent=`${report.mode==='mock'?'모의 실행 (모델 평가 아님)':'실제 Codex CLI'} · ${report.results.length} / ${report.total} 완료 · ${report.status}${report.error?' · '+report.error:''}`;
  const passed=report.results.filter(r=>r.status==='passed').length,failed=report.results.filter(r=>r.status==='failed').length;
  $('harnessSummary').innerHTML=`<div><strong>${passed}</strong><span>통과</span></div><div><strong>${failed}</strong><span>실패</span></div><div><strong>${report.summary?.avgLatencyMs??'—'}</strong><span>평균 응답 시간 · ms</span></div>`;
  $('harnessRows').innerHTML=report.results.map(r=>`<tr><td>${esc(r.name)} / ${r.repeat}</td><td>${r.status==='passed'?'통과':r.status==='cancelled'?'취소':'실패'}</td><td>${r.elapsedMs}ms</td><td>${r.context?.tokens??'전송 안 함'}</td><td>${r.response?`${r.response.output.deliveredTokens} / ${r.response.output.originalTokens}${r.response.output.truncated?' (잘림)':''}`:'—'}</td><td>${r.response?.usage?`${r.response.usage.input_tokens??'—'} / ${r.response.usage.output_tokens??'—'}`:'미보고'}</td></tr>`).join('');
  $('harnessDetails').innerHTML=report.results.map(r=>`<details><summary>${esc(r.name)} · ${r.repeat}회 · ${r.status}</summary><ul>${r.checks.map(c=>`<li>${c.passed?'✓':'✗'} ${esc(c.name)}</li>`).join('')}</ul>${r.error?`<p>${esc(r.error)}</p>`:''}${r.response?`<pre>${esc(r.response.text)}</pre>`:''}</details>`).join('');
}
async function poll(){if(polling)return;polling=true;try{const result=await api('harness');running=result.running;report=result.report;render();}catch(e){error(e.message);}finally{polling=false;}}
$('harnessForm').onsubmit=async event=>{event.preventDefault();if(running)return;try{const spec={mode:$('runMode').value,inputTokenLimit:Number($('inputTokens').value),outputTokenLimit:Number($('outputTokens').value),repetitions:Number($('repeats').value),cases:JSON.parse($('cases').value)};running=true;render();await api('harness/run',spec);await poll();}catch(e){running=false;render();error(e.message);}};
$('cancelHarness').onclick=async()=>{try{await api('harness/cancel',{});await poll();}catch(e){error(e.message);}};
$('resetCases').onclick=()=>{$('cases').value=JSON.stringify(defaults,null,2);};
$('downloadReport').onclick=()=>{const url=URL.createObjectURL(new Blob([JSON.stringify(report,null,2)],{type:'application/json'})),a=document.createElement('a');a.href=url;a.download=`harness-${report.id}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),2000);};
try{token=(await api('bootstrap')).token;const initial=await api('harness');defaults=initial.cases;$('cases').value=JSON.stringify(defaults,null,2);report=initial.report;running=initial.running;render();}catch(e){error(e.message);$('runHarness').disabled=true;}
setInterval(()=>{if(running)poll();},1000);
