const $=id=>document.getElementById(id);
let token,state,polling=false,renderedDraft='',restored=false;
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
async function api(path,data){const response=await fetch('/api/'+path,data===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json','X-Exam-Token':token},body:JSON.stringify(data)});const result=await response.json();if(!response.ok)throw new Error(result.error||'요청 실패');return result;}
function error(message){$('authorStatus').textContent=message;$('authorStatus').classList.add('error');}
function renderProfile(){
  const second=$('profile').value==='round2';$('round2Controls').classList.toggle('hidden',!second);$('round2Briefing').classList.toggle('hidden',!second);$('points').min=second?'10':'1';
  $('trackDescription').textContent=state.round2.tracks.find(t=>t.id===$('track').value)?.description||'';
  const different=state.draft?.problem&&(state.draft.spec?.profile??'general')!==$('profile').value;
  $('draftProfileNotice').textContent=different?'현재 미리보기는 이전 출제 모드의 문제입니다. 선택한 모드로 생성하면 바뀝니다.':'';
}
function applyTrack(){const t=state.round2.tracks.find(t=>t.id===$('track').value);$('topic').value=t.topic;$('output').value=t.id==='analysis'?'report':'pseudocode';renderProfile();}
function chooseProfile(){if($('profile').value==='round2'){$('authorMinutes').value=90;$('points').value=100;applyTrack();}else{$('authorMinutes').value=25;$('points').value=25;}renderProfile();}
function initializeProfiles(){
  $('track').innerHTML=state.round2.tracks.map(t=>`<option value="${esc(t.id)}">${esc(t.label)}</option>`).join('');
  $('output').innerHTML=state.round2.outputs.map(t=>`<option value="${esc(t.id)}">${esc(t.label)}</option>`).join('');
  const b=state.round2.briefing;
  $('round2Briefing').innerHTML=`<div class="eyebrow">ROUND 2 · 공개 안내 확인 ${esc(b.checkedAt)}</div><h2>데이터로 문제를 풀고, 검증까지.</h2><p class="briefing-label">확인된 방향</p><ul>${b.confirmed.map(t=>`<li>${esc(t)}</li>`).join('')}</ul><p><strong>연습 설계</strong> · ${esc(b.inferred)}</p><details><summary>미확인 사항·앱의 범위·출처</summary><p>${esc(b.unknown)}</p><p>${esc(b.limitation)}</p><ul>${b.sources.map(s=>`<li><a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.title)} ↗</a><small>${esc(s.scope)}</small></li>`).join('')}</ul></details>`;
}
function download(name,text,type='text/plain;charset=utf-8'){const a=document.createElement('a'),url=URL.createObjectURL(new Blob([text],{type}));a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
function render(){
  const d=state.draft,running=state.running;
  if(!restored){restored=true;initializeProfiles();if(d?.spec){$('topic').value=d.spec.topic;$('difficulty').value=d.spec.difficulty;$('brief').value=d.spec.brief;$('authorMinutes').value=d.spec.minutes;$('points').value=d.spec.points;$('profile').value=d.spec.profile??'general';for(const id of ['track','output','dataRows','materialTokenBudget'])if(d.spec[id]!==undefined)$(id).value=d.spec[id];}if(new URLSearchParams(location.search).get('profile')==='round2'&&$('profile').value!=='round2'){$('profile').value='round2';chooseProfile();}}
  renderProfile();
  for(const el of $('authorForm').querySelectorAll('input,select,textarea'))el.disabled=running;
  $('generate').disabled=running;$('cancelGenerate').classList.toggle('hidden',!running);$('addProblem').disabled=d?.status!=='ready'||running;
  $('addProblem').textContent=d?.status==='added'?'추가 완료 ✓':'문제 은행에 추가';
  $('practiceMission').classList.toggle('hidden',d?.status!=='added');if(d?.status==='added')$('practiceMission').href='/?problem='+encodeURIComponent(d.problemId);
  $('downloadPackage').disabled=!d?.problem||running;$('downloadTemplate').disabled=!d?.problem?.training?.submissionTemplate||running;$('downloadTemplate').classList.toggle('hidden',!d?.problem?.training?.submissionTemplate);
  $('authorStatus').classList.toggle('error',d?.status==='failed');
  const seconds=d?Math.floor(((d.finishedAt||Date.now())-d.startedAt)/1000):0;
  const labels={running:`Astra High가 출제 중입니다 · ${seconds}초 경과\n창을 새로고침해도 서버에서 계속 생성합니다.`,ready:`초안 생성 완료 · ${seconds}초\n문제와 첨부를 검토하고 문제 은행에 추가하세요.`,added:'문제 은행에 추가했습니다. 다음 시험의 문항 선택에서 사용할 수 있습니다.',failed:`생성 실패: ${d?.error||'알 수 없는 오류'}`,cancelled:'생성을 취소했습니다.'};
  $('authorStatus').textContent=d?labels[d.status]:'주제와 조건을 입력해 첫 문제를 만들어 보세요.';
  $('previewEmpty').textContent=running?`Astra High가 문제·자료·비공개 정답을 생성하고 있습니다.\n${seconds}초 경과 · 완료 후 자료 형식과 예산을 검사합니다.`:d?.status==='failed'?`생성 실패: ${d.error}`:'생성이 완료되면 문제와 자료를 여기서 확인할 수 있어요.';
  $('bankList').innerHTML=state.catalog.map(p=>`<div class="bank-item">${esc(p.title)}<small>${p.profile==='round2'?'2차 대비 · ':''}${p.generatedAt?'AI 생성 · ':''}${p.minutes}분 · ${p.points}점</small></div>`).join('');
  const key=d?.problem?d.id:'';
  if(key!==renderedDraft){renderedDraft=key;$('previewEmpty').classList.toggle('hidden',!!key);$('draftPreview').classList.toggle('hidden',!key);
    if(key){const p=d.problem;$('draftTitle').textContent=p.title;$('draftMeta').textContent=`${p.category} · ${p.minutes}분 · ${p.points}점 · 첨부 합계 ${p.files.reduce((n,f)=>n+f.tokens,0).toLocaleString()}토큰${p.training?` · 데이터 ${p.training.dataRows}행`:''}`;$('draftBody').textContent=p.markdown;$('draftFiles').innerHTML=p.files.map((f,i)=>`<details><summary>${esc(f.name)} · ${f.tokens.toLocaleString()}토큰</summary><button class="text-button" data-download="${i}">파일 다운로드 ↓</button><pre>${esc(f.text)}</pre></details>`).join('');$('templatePreview').classList.toggle('hidden',!p.training?.submissionTemplate);$('templateText').textContent=p.training?.submissionTemplate??'';$('draftUsage').textContent=`${d.hasAnswerKey?'비공개 정답·채점 기준 준비 완료':'기존 문항: 제출 후 필요한 정답 기준을 준비합니다.'} · 생성 모델: ${d.model} · 추론: ${d.reasoningEffort}${d.usage?` · CLI 사용량 입력 ${d.usage.input_tokens??'미보고'} / 출력 ${d.usage.output_tokens??'미보고'}토큰`:''}`;}
  }
}
async function refresh(){if(polling)return;polling=true;try{state=await api('author');render();}catch(e){error(e.message);}finally{polling=false;}}
$('authorForm').onsubmit=async event=>{event.preventDefault();$('generate').disabled=true;try{await api('author/generate',{profile:$('profile').value,track:$('track').value,output:$('output').value,dataRows:Number($('dataRows').value),materialTokenBudget:Number($('materialTokenBudget').value),topic:$('topic').value,difficulty:$('difficulty').value,brief:$('brief').value,minutes:Number($('authorMinutes').value),points:Number($('points').value)});await refresh();}catch(e){error(e.message);$('generate').disabled=false;}};
$('profile').onchange=chooseProfile;$('track').onchange=applyTrack;
$('downloadPackage').onclick=()=>{if(!state.draft?.problem)return;download('exam-problem-public.json',JSON.stringify({format:'ai-exam-public-v1',problem:state.draft.problem},null,2),'application/json');};
$('downloadTemplate').onclick=()=>{const template=state.draft?.problem?.training?.submissionTemplate;if(template)download('submission-template.md',template);};
$('draftFiles').onclick=event=>{const target=event.target.closest('[data-download]');if(target){const f=state.draft.problem.files[Number(target.dataset.download)];if(f)download(f.name,f.text);}};
$('cancelGenerate').onclick=async()=>{try{await api('author/cancel',{});await refresh();}catch(e){error(e.message);}};
$('addProblem').onclick=async()=>{const id=state.draft?.id;$('addProblem').disabled=true;try{await api('author/add',{draftId:id});await refresh();}catch(e){error(e.message);$('addProblem').disabled=false;}};
try{token=(await api('bootstrap')).token;await refresh();}catch(e){error(e.message);}
setInterval(()=>{if(state?.running)refresh();},1500);
