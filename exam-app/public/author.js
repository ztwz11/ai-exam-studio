const $=id=>document.getElementById(id);
let token,state,polling=false,renderedDraft='',restored=false;
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
async function api(path,data){const response=await fetch('/api/'+path,data===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json','X-Exam-Token':token},body:JSON.stringify(data)});const result=await response.json();if(!response.ok)throw new Error(result.error||'요청 실패');return result;}
function error(message){$('authorStatus').textContent=message;$('authorStatus').classList.add('error');}
function render(){
  const d=state.draft,running=state.running;
  if(!restored){restored=true;if(d?.spec){$('topic').value=d.spec.topic;$('difficulty').value=d.spec.difficulty;$('brief').value=d.spec.brief;$('authorMinutes').value=d.spec.minutes;$('points').value=d.spec.points;}}
  for(const el of $('authorForm').querySelectorAll('input,select,textarea'))el.disabled=running;
  $('generate').disabled=running;$('cancelGenerate').classList.toggle('hidden',!running);$('addProblem').disabled=d?.status!=='ready'||running;
  $('addProblem').textContent=d?.status==='added'?'추가 완료 ✓':'문제 은행에 추가';
  $('authorStatus').classList.toggle('error',d?.status==='failed');
  const seconds=d?Math.floor(((d.finishedAt||Date.now())-d.startedAt)/1000):0;
  const labels={running:`Astra High가 출제 중입니다 · ${seconds}초 경과\n창을 새로고침해도 서버에서 계속 생성합니다.`,ready:`초안 생성 완료 · ${seconds}초\n문제와 첨부를 검토하고 문제 은행에 추가하세요.`,added:'문제 은행에 추가했습니다. 다음 시험의 문항 선택에서 사용할 수 있습니다.',failed:`생성 실패: ${d?.error||'알 수 없는 오류'}`,cancelled:'생성을 취소했습니다.'};
  $('authorStatus').textContent=d?labels[d.status]:'주제와 조건을 입력해 첫 문제를 만들어 보세요.';
  $('bankList').innerHTML=state.catalog.map(p=>`<div class="bank-item">${esc(p.title)}<small>${p.generatedAt?'AI 생성 · ':''}${p.minutes}분 · ${p.points}점</small></div>`).join('');
  const key=d?.problem?d.id:'';
  if(key!==renderedDraft){renderedDraft=key;$('previewEmpty').classList.toggle('hidden',!!key);$('draftPreview').classList.toggle('hidden',!key);
    if(key){const p=d.problem;$('draftTitle').textContent=p.title;$('draftMeta').textContent=`${p.category} · ${p.minutes}분 · ${p.points}점 · 첨부 합계 ${p.files.reduce((n,f)=>n+f.tokens,0).toLocaleString()}토큰`;$('draftBody').textContent=p.markdown;$('draftFiles').innerHTML=p.files.map(f=>`<details open><summary>${esc(f.name)} · ${f.tokens.toLocaleString()}토큰</summary><pre>${esc(f.text)}</pre></details>`).join('');$('draftUsage').textContent=`${d.hasAnswerKey?'비공개 정답·채점 기준 준비 완료':'기존 문항: 제출 후 필요한 정답 기준을 준비합니다.'} · 생성 모델: ${d.model} · 추론: ${d.reasoningEffort}${d.usage?` · CLI 사용량 입력 ${d.usage.input_tokens??'미보고'} / 출력 ${d.usage.output_tokens??'미보고'}토큰`:''}`;}
  }
}
async function refresh(){if(polling)return;polling=true;try{state=await api('author');render();}catch(e){error(e.message);}finally{polling=false;}}
$('authorForm').onsubmit=async event=>{event.preventDefault();$('generate').disabled=true;try{await api('author/generate',{topic:$('topic').value,difficulty:$('difficulty').value,brief:$('brief').value,minutes:Number($('authorMinutes').value),points:Number($('points').value)});await refresh();}catch(e){error(e.message);$('generate').disabled=false;}};
$('cancelGenerate').onclick=async()=>{try{await api('author/cancel',{});await refresh();}catch(e){error(e.message);}};
$('addProblem').onclick=async()=>{const id=state.draft?.id;$('addProblem').disabled=true;try{await api('author/add',{draftId:id});await refresh();}catch(e){error(e.message);$('addProblem').disabled=false;}};
try{token=(await api('bootstrap')).token;await refresh();}catch(e){error(e.message);}
setInterval(()=>{if(state?.running)refresh();},1500);
