const $=id=>document.getElementById(id);
let gradingResult=null,gradingPolling=false,gradeSignature='';
let boot,session,token,problems,offset=0,mode='exam',busy=null,saving=Promise.resolve(),saveTimer,polling=false,activePane='chat',activeProblemTab='problem',toastTimer;
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const chars=s=>Array.from(s).length;
const fmt=ms=>{const seconds=Math.max(0,Math.floor(ms/1000));return `${String(Math.floor(seconds/60)).padStart(2,'0')}:${String(seconds%60).padStart(2,'0')}`;};
const time=ms=>new Date(ms).toLocaleTimeString('ko-KR',{hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false});
const used=q=>q.messages.filter(m=>m.role==='user'&&m.status!=='failed').length;
const limitLabel=c=>c.inputTokenLimit?`${c.inputTokenLimit.toLocaleString()}토큰`:`${c.contextLimit?.toLocaleString()}자 (기존 시험)`;
const contextLabel=c=>c.unit==='tokens'?`${c.tokens.toLocaleString()} / ${c.limit.toLocaleString()}토큰`:`${c.chars.toLocaleString()}자`;
const current=()=>session?.questions[session.current];
const editable=()=>session?.status==='running';
function inline(text){return esc(text).replace(/`([^`]+)`/g,'<code>$1</code>').replace(/\*\*([^*]+)\*\*/g,'<strong>$1</strong>');}
function markdown(source){
  const lines=source.replace(/\r/g,'').split('\n');let out=[],i=0;
  const cells=line=>line.trim().replace(/^\|/,'').replace(/\|$/,'').split('|').map(x=>x.trim());
  while(i<lines.length){let line=lines[i];if(!line.trim()){i++;continue;}
    if(line.startsWith('```')){i++;let code=[];while(i<lines.length&&!lines[i].startsWith('```'))code.push(lines[i++]);i++;out.push(`<pre><code>${esc(code.join('\n'))}</code></pre>`);continue;}
    const heading=line.match(/^(#{1,3}) (.*)/);if(heading){out.push(`<h${heading[1].length}>${inline(heading[2])}</h${heading[1].length}>`);i++;continue;}
    if(line.trim().startsWith('|')&&lines[i+1]?.match(/^\s*\|[\s:|\-]+\|\s*$/)){const heads=cells(line);i+=2;let rows=[];while(i<lines.length&&lines[i].trim().startsWith('|'))rows.push(cells(lines[i++]));out.push(`<div class="table-wrap"><table><thead><tr>${heads.map(c=>`<th>${inline(c)}</th>`).join('')}</tr></thead><tbody>${rows.map(row=>`<tr>${row.map(c=>`<td>${inline(c)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`);continue;}
    if(/^>/.test(line)){let block=[];while(i<lines.length&&/^>/.test(lines[i]))block.push(inline(lines[i++].replace(/^> ?/,'')));out.push(`<blockquote>${block.join('<br>')}</blockquote>`);continue;}
    if(/^\s*[-*] /.test(line)||/^\d+\. /.test(line)){const ordered=/^\d+\. /.test(line),tag=ordered?'ol':'ul',re=ordered?/^\d+\. /:/^\s*[-*] /;let items=[];while(i<lines.length&&re.test(lines[i]))items.push(`<li>${inline(lines[i++].replace(re,''))}</li>`);out.push(`<${tag}>${items.join('')}</${tag}>`);continue;}
    out.push(`<p>${inline(line)}</p>`);i++;
  }return out.join('');
}
async function api(path,data){const response=await fetch(`/api/${path}`,data===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json','X-Exam-Token':token},body:JSON.stringify(data)});const result=await response.json();if(!response.ok)throw new Error(result.error||'요청에 실패했습니다.');return result;}
function toast(text){$('toast').textContent=text;$('toast').classList.remove('hidden');clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast').classList.add('hidden'),6000);}
function merge(result,{full=false}={}){
  if(session&&result.session&&result.session.id!==session.id&&result.session.startedAt<session.startedAt)return;
  if(result.session?.id!==session?.id){gradingResult=null;gradeSignature='';if($('modal').open)$('modal').close();$('modalBody').replaceChildren();}
  offset=result.serverNow-Date.now();busy=result.busy;if(result.problems)problems=result.problems;
  if(!session||full||session.id!==result.session?.id){session=result.session;return;}
  const previous=session;
  session=result.session;
  // Keep unsaved local editor contents while polling server-controlled state.
  if(session && previous){for(let i=0;i<session.questions.length;i++){for(const key of ['answer','notes','draft','flagged','done','attachments','includeProblem'])session.questions[i][key]=previous.questions[i][key];}session.current=previous.current;}
}
function renderSetup(){
  document.body.classList.remove('exam-active');
  $('loading').classList.add('hidden');$('workspace').classList.add('hidden');$('setup').classList.remove('hidden');
  renderLibrary();
  $('problemList').innerHTML=(boot.catalog||problems).map((p,i)=>`<label class="problem-item"><input type="checkbox" data-choose-problem="${esc(p.id)}" checked aria-label="${esc(p.title)} 시험에 포함"><span class="problem-number">${i+1}</span><div><strong>${esc(p.title)}</strong><p>${esc(p.category)}</p></div><span>${p.minutes}분 · ${p.points}점</span></label>`).join('');
  updateSelectionSummary();
}
function render(){
  if(!session){renderSetup();return;}
  document.body.classList.add('exam-active');
  $('loading').classList.add('hidden');$('setup').classList.add('hidden');$('workspace').classList.remove('hidden');
  renderNav();renderQuestion();renderState();
}
function renderNav(){
  $('questionNav').innerHTML=problems.map((p,i)=>{const q=session.questions[i];return `<button class="nav-item ${i===session.current?'active':''} ${q.done?'done':''}" data-question="${i}" aria-current="${i===session.current?'step':'false'}" aria-label="${i+1}번 ${esc(p.title)}"><span class="nav-number">${q.done?'✓':i+1}</span><span class="nav-text"><strong>${esc(p.title)}${q.flagged?'<span class="flag">⚑</span>':''}</strong><small>${p.points}점 · 권장 ${p.minutes}분</small></span></button>`;}).join('');
  const done=session.questions.filter(q=>q.done).length;$('progressLabel').textContent=`작성 완료 ${done} / ${session.questions.length}`;$('progressBar').style.width=`${done/session.questions.length*100}%`;
}
function renderQuestion(){
  const q=current(),p=problems[session.current];
  $('questionCategory').textContent=`QUESTION 0${session.current+1} / ${p.category}`;
  $('questionTitle').textContent=p.title;$('questionMeta').textContent=`권장 ${p.minutes}분 · ${p.points}점`;$('fileCount').textContent=p.files.length;
  $('problemBody').innerHTML=markdown(p.markdown);
  renderData();
  $('prompt').value=q.draft;$('answer').value=q.answer;$('notes').value=q.notes;$('done').checked=q.done;
  $('attachments').innerHTML=`<label class="attachment-chip"><input type="checkbox" data-problem ${q.includeProblem?'checked':''}>문제 원문</label>`+p.files.map(f=>`<label class="attachment-chip"><input type="checkbox" data-file="${esc(f.name)}" ${q.attachments.includes(f.name)?'checked':''}>${esc(f.name)} <small>${(f.tokens??0).toLocaleString()}토큰</small></label>`).join('');
  $('flagButton').classList.toggle('selected',q.flagged);$('flagButton').textContent=q.flagged?'⚑ 검토 표시됨':'⚑ 나중에 검토';
  $('nextQuestion').textContent=session.current===session.questions.length-1?'첫 문항으로 ↑':'다음 문항 →';
  renderMessages();renderCounts();showPane(activePane);showProblemTab(activeProblemTab);
}
function renderMessages(){
  const q=current(),box=$('messages'),nearBottom=box.scrollHeight-box.scrollTop-box.clientHeight<100;
  if(!q.messages.length)box.innerHTML='<div class="empty-chat"><div class="assistant-symbol">✧</div><strong>질문이 좋은 답의 시작입니다.</strong><p>자료를 읽고 필요한 도움을 요청하세요.<br>AI의 답을 검토하고 최종 판단은 직접 내려보세요.</p></div>';
  else box.innerHTML=q.messages.map(m=>`<article class="message ${m.role}"><div class="message-label"><b>${m.role==='user'?'나의 질문':'AI 도우미'}</b><span>${time(m.at)}</span></div><div class="message-content ${m.role==='assistant'?'prose':''}">${m.role==='assistant'?markdown(m.text):esc(m.text)}</div>${m.context?`<div class="message-meta">문맥 ${contextLabel(m.context)} · 이전 ${m.context.includedTurns}회 포함${m.context.droppedTurns?` · ${m.context.droppedTurns}회 제외`:''}</div>`:''}${m.output?`<div class="message-meta">표시 답변 ${m.output.deliveredTokens} / ${m.output.limit}토큰 · ${m.elapsedMs??'—'}ms${m.usage?` · CLI 사용량 입력 ${m.usage.input_tokens??'미보고'} / 출력 ${m.usage.output_tokens??'미보고'}`:''}</div>${m.output.truncated?'<div class="message-error">답변 한도에 도달해 뒷부분을 잘랐습니다. 원본 생성량·비용을 제한한 것은 아닙니다.</div>':''}`:''}${m.status==='failed'?`<div class="message-error">${esc(m.error)} · 질문 횟수는 차감하지 않았습니다.</div>`:''}${m.role==='assistant'?`<button class="text-button copy-message" data-message="${m.id}">답변 복사</button>`:''}</article>`).join('');
  if(busy?.question===session.current)box.insertAdjacentHTML('beforeend','<div class="waiting"><span class="spinner"></span>Codex가 답변을 작성하고 있습니다…</div>');
  if(nearBottom)box.scrollTop=box.scrollHeight;
}
function renderCounts(){const q=current();$('answerLength').textContent=`${chars(q.answer).toLocaleString()}자`;$('promptLength').textContent=`${chars(q.draft).toLocaleString()}자 · Ctrl+Enter 전송`;$('questionUsage').textContent=`질문 ${used(q)} / ${session.config.questionLimit||'∞'}`;}
function renderState(){
  const can=editable(),q=current(),limit=session.config.questionLimit,ended=session.status==='submitted';
  $('modeBadge').textContent=session.config.mode==='exam'?'실전 모드':'연습 모드';
  $('pauseButton').classList.toggle('hidden',session.config.mode!=='practice'||ended);$('pauseButton').textContent=session.status==='paused'?'재개하기':'일시정지';
  $('submitButton').classList.toggle('hidden',ended);$('resultButton').classList.toggle('hidden',!ended);
  $('endBanner').classList.toggle('hidden',can);$('endBanner').textContent=ended?(session.reason==='timeout'?'제한 시간이 종료되어 현재 답안이 자동 제출되었습니다.':'답안을 제출했습니다. 기록을 검토하거나 결과 파일을 내려받으세요.'):'연습을 일시정지했습니다. 재개하면 시간과 입력이 다시 활성화됩니다.';
  for(const id of ['prompt','answer','notes','done','flagButton'])$(id).disabled=!can;
  $('attachments').querySelectorAll('input').forEach(el=>el.disabled=!can||!!busy);
  const readLock=session.config.readFirst&&q.elapsedMs<120000;
  const attachmentOver=renderAttachmentBudget();
  $('sendButton').disabled=attachmentOver||!can||!!busy||!q.draft.trim()||!!(limit&&used(q)>=limit)||readLock;
  $('previewContext').disabled=!can||!q.draft.trim();
  $('cancelButton').classList.toggle('hidden',!busy||ended);
  $('contextStatus').textContent=readLock?`먼저 읽기 · ${fmt(120000-q.elapsedMs)} 후 질문 가능`:`입력 ${limitLabel(session.config)} · 표시 답변 ${session.config.outputTokenLimit??1024}토큰 · ${session.config.historyTurns?'최근 최대 2회 문답':'이전 대화 없음'}`;
  renderCounts();updateTimer();
}
function updateTimer(){
  if(!session)return;const now=Date.now()+offset;
  const stopped=session.status==='submitted'?session.endedAt:session.status==='paused'?session.pausedAt:now;
  const remaining=session.deadline?Math.max(0,session.deadline-stopped):null;
  $('timer').textContent=remaining===null?'∞':fmt(remaining);$('timer').parentElement.classList.toggle('warning',remaining!==null&&remaining<300000);
  $('timerLabel').textContent=session.status==='paused'?'일시정지':session.status==='submitted'?'종료':'남은 시간';
  const q=current(),extra=editable()?Math.max(0,Math.min(now,session.deadline||now)-session.segmentStart):0;
  $('questionTime').textContent=`이 문항에서 보낸 시간 ${fmt(q.elapsedMs+extra)}`;
  if(editable()&&session.deadline&&now>=session.deadline){for(const id of ['prompt','answer','notes','sendButton','done','flagButton'])$(id).disabled=true;poll();}
}
function showPane(pane){activePane=pane;for(const name of ['chat','answer','notes']){$(`${name}Pane`).classList.toggle('hidden',name!==pane);$(`${name}Tab`).classList.toggle('active',name===pane);}}
function showProblemTab(tab){activeProblemTab=tab;for(const name of ['problem','data']){$(`${name}Body`).classList.toggle('hidden',name!==tab);$(`${name}Tab`).classList.toggle('active',name===tab);}}
function expandProblem(expanded){
  $('workspace').classList.toggle('problem-focus',expanded);
  $('expandProblem').setAttribute('aria-pressed',String(expanded));
  $('expandProblem').textContent=expanded?'분할 보기 ↙':'문제 넓게 ↗';
}
$('expandProblem').onclick=()=>expandProblem(!$('workspace').classList.contains('problem-focus'));
document.addEventListener('keydown',event=>{if(event.key==='Escape'&&!$('modal').open)expandProblem(false);});
function saveData(){const q=current();return {sessionId:session.id,question:session.current,answer:q.answer,notes:q.notes,draft:q.draft,done:q.done,flagged:q.flagged,includeProblem:q.includeProblem,attachments:q.attachments};}
function queueSave(extra={}){
  clearTimeout(saveTimer);if(!editable())return saving;
  const data={...saveData(),...extra};$('saveStatus').textContent='저장 중…';
  const request=saving.catch(()=>{}).then(()=>api('save',data)).then(result=>{offset=result.serverNow-Date.now();if(session?.id===data.sessionId){$('saveStatus').textContent=`저장됨 ${time(Date.now())}`;}return result;});
  saving=request;request.catch(error=>{$('saveStatus').textContent='저장 실패';toast(error.message);});return request;
}
function changed(){const q=current();q.answer=$('answer').value;q.notes=$('notes').value;q.draft=$('prompt').value;q.done=$('done').checked;renderCounts();renderState();$('saveStatus').textContent='변경 사항 저장 대기';clearTimeout(saveTimer);saveTimer=setTimeout(()=>queueSave(),400);}
async function navigate(index){
  if(index===session.current)return;
  try{if(editable()){const result=await queueSave({navigate:index});merge(result,{full:true});}else session.current=index;render();}catch(error){toast(error.message);}
}
function openModal(title,html,actions=[]){$('modalTitle').textContent=title;$('modalBody').innerHTML=html;$('modalActions').replaceChildren();for(const action of actions){const button=document.createElement('button');button.textContent=action.label;button.className=action.primary?'primary':'outline-button';button.onclick=action.run;$('modalActions').append(button);}if(!$('modal').open)$('modal').showModal();}
function download(name,text,type='text/plain;charset=utf-8'){const a=document.createElement('a'),url=URL.createObjectURL(new Blob([text],{type}));a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),2000);}
function resultMarkdown(){
  const header=`# AI 활용 역량 모의훈련 결과\n\n- 모드: ${session.config.mode}\n- 시작: ${new Date(session.startedAt).toLocaleString('ko-KR')}\n- 종료: ${new Date(session.endedAt).toLocaleString('ko-KR')}\n- 종료 사유: ${session.reason}\n- 입력 한도: ${limitLabel(session.config)}\n- 표시 답변 한도: ${session.config.outputTokenLimit??1024}토큰 (생성/과금 한도 아님)\n- 토크나이저: o200k_base (Codex 내부 문맥 제외)\n- 질문 한도: 문항당 ${session.config.questionLimit||'무제한'}\n- AI 자동 채점은 연습용 참고 평가입니다.\n`;
  return header+session.questions.map((q,i)=>`\n## ${i+1}번 ${problems[i].title}\n\n사용 시간: ${fmt(q.elapsedMs)} / AI 질문: ${used(q)}회\n\n### 최종 답안\n\n${q.answer||'(미작성)'}\n\n### 검증 메모\n\n${q.notes||'(없음)'}\n\n### AI 활용 기록\n\n${q.messages.map(m=>`#### ${m.role==='user'?'질문':'답변'} · ${time(m.at)}\n\n${m.text}\n${m.status==='failed'?`\n실패: ${m.error}\n`:''}${m.context?`\n문맥 ${contextLabel(m.context)}, 이전 문답 ${m.context.includedTurns}회 포함, ${m.context.droppedTurns}회 제외\n`:''}${m.output?`\n표시/원본 답변: ${m.output.deliveredTokens}/${m.output.originalTokens}토큰, 잘림: ${m.output.truncated}, 응답 시간: ${m.elapsedMs}ms\n`:''}${m.usage?`\nCLI 사용량: ${JSON.stringify(m.usage)}\n`:''}`).join('\n')}`).join('\n');
}
function showResults(){
  if(session?.status!=='submitted')return;
  const answered=session.questions.filter(q=>q.answer.trim()).length,total=session.questions.reduce((a,q)=>a+q.elapsedMs,0),questions=session.questions.reduce((a,q)=>a+used(q),0);
  openModal('이번 연습의 기록',`<p>제출이 완료되어 최종 답안을 자동 채점합니다. 정답과 세부 기준은 종료 후에만 공개됩니다.</p><div class="result-stats"><div><strong>${answered} / ${session.questions.length}</strong><span>답안을 작성한 문항</span></div><div><strong>${fmt(total)}</strong><span>총 풀이 시간</span></div><div><strong>${questions}회</strong><span>AI 질문</span></div></div><section id="gradePanel" aria-live="polite"><p>채점 상태를 확인하는 중…</p></section>`,[
    {label:'답안 기록 다운로드',run:()=>download(`AI모의시험_${session.id.slice(0,8)}.md`,resultMarkdown())},
    {label:'채점 포함 JSON',run:()=>download(`AI모의시험_${session.id.slice(0,8)}.json`,JSON.stringify({session,problemTitles:problems.map(p=>p.title),grading:gradingResult},null,2),'application/json')},
    {label:'새 시험 준비',run:async()=>{try{if(['queued','running'].includes(gradingResult?.status)){toast('자동 채점이 끝난 뒤 새 시험을 시작하세요.');return;}const fresh=await api('bootstrap');boot.catalog=fresh.catalog;$('modal').close();renderSetup();}catch(error){toast(error.message);}}}
  ]);
  gradeSignature='';if(gradingResult)renderGrading();refreshGrading();
}
function renderGrading(){
  if(!$('gradePanel')||session?.status!=='submitted'||!gradingResult)return;
  const g=gradingResult,signature=JSON.stringify(g);if(signature===gradeSignature)return;gradeSignature=signature;
  const s=g.summary,finished=g.status==='complete',failed=g.status==='failed';
  $('gradePanel').innerHTML=`<div class="grade-summary"><strong>${finished&&s?`${s.totalScore} / ${s.maxPoints}점`:failed?'일부 문항 채점 실패':'자동 채점 중…'}</strong><p>${s?`${s.completed} / ${s.total}문항 완료 · `:''}${esc(g.phase||'채점 대기')}${g.current!==undefined&&!finished?` · ${g.current+1}번`:''}</p></div><p class="small-note">GPT-6 Astra · High의 연습용 평가입니다. 점수와 피드백은 검토가 필요합니다. 채팅·메모가 아닌 최종 제출 답안만 채점합니다.</p>${g.error?`<p class="message-error">${esc(g.error)}</p>`:''}${failed?'<p>실패한 문항은 0점으로 처리하지 않습니다. 완료된 문항은 유지하고 미완료 문항만 다시 채점합니다.</p><button id="retryGrading" class="primary compact">미완료 채점 재시도</button>':''}${(g.results||[]).map((r,i)=>`<details class="grade-question" open><summary>${i+1}. ${esc(r.title)} · ${r.status==='complete'?`${r.score} / ${r.maxPoints}점`:'채점 실패'}</summary>${r.status==='failed'?`<p class="message-error">${esc(r.error)}</p>`:`<p>${esc(r.summary)}</p><div class="table-wrap"><table class="result-table"><thead><tr><th>평가 항목</th><th>점수</th><th>인정·감점 이유</th></tr></thead><tbody>${r.criteria.map(c=>`<tr><td>${esc(c.label)}</td><td>${c.points} / ${c.maxPoints}</td><td>${esc(c.feedback)}${c.evidence?`<blockquote>제출 답안: ${esc(c.evidence)}</blockquote>`:''}</td></tr>`).join('')}</tbody></table></div>${r.strengths.length?`<h3>잘한 점</h3><ul>${r.strengths.map(t=>`<li>${esc(t)}</li>`).join('')}</ul>`:''}${r.improvements.length?`<h3>다음에 개선할 점</h3><ul>${r.improvements.map(t=>`<li>${esc(t)}</li>`).join('')}</ul>`:''}${r.answerKey?`<details class="answer-review"><summary>모범 답안 · 해설 · 세부 채점 기준 보기</summary><div class="prose"><h3>모범 답안</h3>${markdown(r.answerKey.referenceAnswer)}<h3>해설</h3>${markdown(r.answerKey.explanation)}<h3>세부 채점 기준</h3>${r.answerKey.criteria.map(c=>`<h4>${esc(c.label)} · ${c.maxPoints}점</h4><p>${esc(c.expected)}</p><p>부분점수: ${esc(c.partialCredit)}</p>`).join('')}</div></details>`:''}`}</details>`).join('')}`;
  if($('retryGrading'))$('retryGrading').onclick=async()=>{try{$('retryGrading').disabled=true;await api('grading/retry',{sessionId:session.id});await refreshGrading();}catch(error){toast(error.message);$('retryGrading').disabled=false;}};
}
async function refreshGrading(){
  if(gradingPolling||session?.status!=='submitted'||!$('gradePanel'))return;
  gradingPolling=true;const id=session.id;
  try{const result=await api(`grading?sessionId=${encodeURIComponent(id)}`);if(session.id===id&&session.status==='submitted'){gradingResult=result;renderGrading();}}
  catch(error){if($('gradePanel'))$('gradePanel').textContent=error.message;}
  finally{gradingPolling=false;}
}
setInterval(()=>{if($('modal').open&&session?.status==='submitted'&&gradingResult?.status!=='complete')refreshGrading();},2000);
function showSettings(){if(!session)return;const c=session.config;openModal('현재 시험 설정',`<p>모드: <strong>${c.mode==='exam'?'실전':'연습'}</strong><br>시간: ${c.minutes?`${c.minutes}분`:'무제한'}<br>문항당 질문: ${c.questionLimit||'무제한'}회<br>입력 문맥 한도: ${limitLabel(c)}<br>첨부 자료 한도: ${c.attachmentTokenLimit??3072}토큰<br>표시 답변 한도: ${c.outputTokenLimit??1024}토큰<br>이전 대화: ${c.historyTurns?'최근 최대 2회':'없음'}<br>처음 2분 AI 제한: ${c.readFirst?'사용':'사용하지 않음'}</p><p>토큰은 o200k_base로 계산합니다. 문제·첨부·이전 문답·현재 질문·시험용 지침이 입력에 포함됩니다. Codex 내부 시스템 지침과 메시지 포맷은 제외하므로 CLI가 보고하는 실제 사용량과 다릅니다. 출력은 받은 답변의 표시량을 제한하며 생성·과금 상한이 아닙니다.</p><p>실전 모드에서는 새로고침하거나 브라우저를 닫아도 시간이 흐릅니다. AI 응답 대기 시간도 시험 시간에 포함됩니다.</p>`);}
async function poll(){
  if(polling||!session)return;polling=true;
  try{const before=JSON.stringify(current()?.messages),status=session.status,id=session.id,result=await api('session');merge(result);if(session){renderState();if(before!==JSON.stringify(current()?.messages)||busy)renderMessages();if(id!==session.id||status!==session.status){clearTimeout(saveTimer);render();if(session.status==='submitted'){showResults();}}}}catch{$('saveStatus').textContent='서버 연결 확인 필요';}finally{polling=false;}
}
async function sendPrompt(){
  if($('sendButton').disabled)return;
  const button=$('sendButton');button.disabled=true;
  try{
    await queueSave();const data={...saveData(),prompt:current().draft};
    // Validate the exact input before locking the UI or consuming a question.
    const context=await api('context',data);
    $('contextStatus').textContent=`이번 문맥 ${contextLabel(context)} · 이전 ${context.includedTurns}회 포함`;
    busy={question:session.current,startedAt:Date.now()};current().draft='';$('prompt').value='';renderState();renderMessages();
    const result=await api('ask',data);merge(result);renderState();renderMessages();renderNav();
  }catch(error){busy=null;toast(error.message);await poll();renderState();}
}
$('examMode').onclick=()=>setMode('exam');$('practiceMode').onclick=()=>setMode('practice');
function setMode(value){mode=value;$('examMode').classList.toggle('selected',mode==='exam');$('practiceMode').classList.toggle('selected',mode==='practice');for(const id of ['minutes','questionLimit']){$(id).min=mode==='exam'?'1':'0';if(mode==='exam'&&Number($(id).value)===0)$(id).value=id==='minutes'?90:3;}}
$('startForm').onsubmit=async event=>{event.preventDefault();const button=event.submitter;button.disabled=true;try{const result=await api('start',{problemIds:[...$('problemList').querySelectorAll('[data-choose-problem]:checked')].map(el=>el.dataset.chooseProblem),mode,minutes:Number($('minutes').value),questionLimit:Number($('questionLimit').value),inputTokenLimit:Number($('inputTokenLimit').value),outputTokenLimit:Number($('outputTokenLimit').value),attachmentTokenLimit:Number($('attachmentTokenLimit').value),historyTurns:Number($('historyTurns').value),readFirst:$('readFirst').checked});merge(result,{full:true});render();}catch(error){toast(error.message);}finally{button.disabled=false;}};
$('questionNav').onclick=event=>{const target=event.target.closest('[data-question]');if(target)navigate(Number(target.dataset.question));};
$('nextQuestion').onclick=()=>navigate((session.current+1)%session.questions.length);
for(const pane of ['chat','answer','notes'])$(`${pane}Tab`).onclick=()=>showPane(pane);
for(const tab of ['problem','data'])$(`${tab}Tab`).onclick=()=>showProblemTab(tab);
for(const id of ['prompt','answer','notes'])$(id).addEventListener('input',changed);
$('done').onchange=()=>{changed();renderNav();};
$('flagButton').onclick=()=>{current().flagged=!current().flagged;queueSave();renderNav();$('flagButton').classList.toggle('selected',current().flagged);$('flagButton').textContent=current().flagged?'⚑ 검토 표시됨':'⚑ 나중에 검토';};
$('attachments').onchange=()=>{current().includeProblem=$('attachments').querySelector('[data-problem]').checked;current().attachments=[...$('attachments').querySelectorAll('[data-file]:checked')].map(el=>el.dataset.file);queueSave();renderState();};
$('previewContext').onclick=async()=>{try{const data={...saveData(),prompt:current().draft},context=await api('context',data);openModal('이번 요청에 전달하는 문맥',`<p><strong>${contextLabel(context)}</strong> · 이전 문답 ${context.includedTurns}회 포함 · ${context.droppedTurns}회 제외</p><p>기준: ${esc(context.tokenizer)} · 자료/질문 ${context.inputTextTokens} + 지침 ${context.instructionTokens}토큰. Codex 내부 문맥은 제외됩니다.<br>첨부 ${context.attachmentTokens} / ${context.attachmentTokenLimit}토큰<br>문제 원문 ${context.includesProblem?'포함':'제외'} · 첨부 ${context.files.length}개 · 표시 답변 한도 ${context.outputTokenLimit}토큰</p><details><summary>시험용 지침</summary><pre>${esc(context.instructions)}</pre></details><pre>${esc(context.input)}</pre>`);}catch(error){toast(error.message);}};
$('sendButton').onclick=sendPrompt;
$('prompt').addEventListener('keydown',event=>{if(event.key==='Enter'&&(event.ctrlKey||event.metaKey)){event.preventDefault();sendPrompt();}});
$('cancelButton').onclick=async()=>{try{await api('cancel',{sessionId:session.id});toast('응답 취소를 요청했습니다.');}catch(error){toast(error.message);}};
$('pauseButton').onclick=async()=>{try{if(editable())await queueSave();merge(await api('pause',{sessionId:session.id}),{full:true});render();}catch(error){toast(error.message);}};
$('resetButton').onclick=()=>{
  const attemptId=session.id;
  openModal('현재 시험을 처음부터 다시 시작할까요?',`<p>현재 시험의 <strong>모든 문항</strong>을 초기화합니다. 답안·메모·프롬프트 초안·AI 대화와 질문 횟수·완료 및 검토 표시·풀이 시간이 모두 초기화됩니다.</p><p>문제와 자료, 시험 설정은 유지됩니다. 시간은 <strong>${session.config.minutes?`${session.config.minutes}분`:'무제한'}</strong>으로 돌아가고 첫 문항부터 즉시 시작합니다. 정답과 채점 결과는 다시 숨겨집니다.</p><p class="small-note">이전 기록은 복구용으로 이 PC에 보관됩니다. 진행 중인 AI 요청이나 채점이 있으면 완료 또는 취소 후 초기화하세요.</p>`,[
    {label:'계속 풀기',run:()=>$('modal').close()},
    {label:'전체 초기화 후 재시작',primary:true,run:async()=>{
      const buttons=[...$('modalActions').querySelectorAll('button')];buttons.forEach(b=>b.disabled=true);
      try{clearTimeout(saveTimer);await saving.catch(()=>{});const result=await api('reset',{sessionId:attemptId});merge(result,{full:true});showPane('chat');showProblemTab('problem');render();$('saveStatus').textContent='새 시험 시작 · 전체 초기화 완료';toast('시간과 모든 풀이 기록을 초기화했습니다.');}
      catch(error){toast(error.message);}finally{buttons.forEach(b=>b.disabled=false);}
    }}
  ]);
};
$('submitButton').onclick=()=>{const missing=session.questions.filter(q=>!q.answer.trim()).length;openModal('답안을 최종 제출할까요?',`<p>${missing?`아직 답안을 작성하지 않은 문항이 <strong>${missing}개</strong> 있습니다.`:'모든 문항에 답안이 작성되어 있습니다.'}</p><p>제출하면 시간 측정이 끝나고 답안을 수정할 수 없습니다. 작성한 답안, 질문과 응답, 메모를 모두 저장합니다.</p>`,[{label:'계속 풀기',run:()=>$('modal').close()},{label:'최종 제출',primary:true,run:async()=>{try{if(editable())await queueSave();merge(await api('submit',saveData()),{full:true});render();showResults();}catch(error){toast(error.message);}}}]);};
$('resultButton').onclick=showResults;$('settingsButton').onclick=showSettings;
$('closeModal').onclick=()=>$('modal').close();
$('helpButton').onclick=()=>openModal('실전 연습실 이용 안내','<p><strong>1.</strong> 왼쪽에서 문항을 선택하고 문제와 첨부 자료를 읽으세요.<br><strong>2.</strong> AI에 전달할 자료를 선택하고 프롬프트를 작성하세요.<br><strong>3.</strong> 답변을 검증한 뒤 최종 답안 탭에 직접 작성하세요.<br><strong>4.</strong> 제출 후 답안과 대화 기록을 내려받아 복기하세요.</p><p>Codex CLI의 로그인과 이용 한도를 사용합니다. 이 채팅의 대화 기록은 전달되지 않습니다. 매 질문마다 새 CLI 세션을 사용하며, 선택한 최근 문답만 명시적으로 다시 전달합니다.</p><p>AI 응답 실패·취소는 질문 횟수에서 제외합니다. 대기 중에도 시간은 흐르며, 종료 후 도착한 답변은 사용하지 않습니다. 이 도구는 개인 연습용이며 공식 시험 감독·채점 시스템이 아닙니다.</p>');
$('messages').onclick=async event=>{const target=event.target.closest('[data-message]');if(target){try{await navigator.clipboard.writeText(current().messages.find(m=>m.id===target.dataset.message).text);toast('답변을 복사했습니다.');}catch{toast('복사 권한이 없습니다. 답변을 선택해 복사하세요.');}}};
$('dataBody').onclick=event=>{
  const target=event.target.closest('[data-download]');
  if(target){const f=problems[session.current].files[Number(target.dataset.download)];if(f.id){const a=document.createElement('a');a.href=`/api/material/${f.id}`;a.download=f.name;a.click();}else download(f.name,'\uFEFF'+f.text,'text/plain;charset=utf-8');}
};
window.addEventListener('pagehide',()=>{if(editable())fetch('/api/save',{method:'POST',headers:{'Content-Type':'application/json','X-Exam-Token':token},body:JSON.stringify(saveData()),keepalive:true}).catch(()=>{});});
setInterval(updateTimer,250);setInterval(poll,2000);
try{boot=await api('bootstrap');token=boot.token;problems=boot.problems;merge(boot,{full:true});$('connection').textContent='Codex CLI 연결';render();if(session?.status==='submitted')showResults();}catch(error){$('loading').textContent=`연결할 수 없습니다. ${error.message}`;}

function fileCard(f,i){
  const meta=`${f.kind?.toUpperCase()||'자료'} · ${f.pages?f.pages.length+'페이지 · ':''}${(f.tokens??0).toLocaleString()}토큰`;
  const rows=!f.id&&f.kind==='csv'?f.text.trim().split(/\r?\n/).map(line=>line.split(',')):[];
  const table=rows.length?`<div class="table-wrap"><table><thead><tr>${rows[0].map(x=>`<th>${esc(x)}</th>`).join('')}</tr></thead><tbody>${rows.slice(1).map(row=>`<tr>${row.map(x=>`<td>${esc(x)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`:'';
  return `<article class="data-file"><header><div><h3>${esc(f.name)}</h3><span class="small-note">${meta}</span></div>${i!==undefined?`<button class="text-button" data-download="${i}">원본 다운로드 ↓</button>`:''}</header>${(f.warnings||[]).map(w=>`<p class="material-warning">${esc(w)}</p>`).join('')}${table}<details><summary>AI가 읽을 텍스트 확인</summary><pre class="material-text">${esc(f.text)}</pre></details></article>`;
}
function renderLibrary(){
  const select=$('materialQuestion'),previous=select.value,available=boot.catalog||problems;
  select.innerHTML=available.map((p,i)=>`<option value="${p.id}">${i+1}번 · ${esc(p.title)}</option>`).join('');
  if(previous)select.value=previous;
  const p=available.find(p=>p.id===select.value);
  $('setupMaterials').innerHTML=p.files.map(f=>fileCard(f)).join('')||'<p class="small-note">등록된 별도 자료가 없습니다. 문제 본문은 시험에서 읽을 수 있습니다.</p>';
}
function renderData(){
  const p=problems[session.current];
  $('dataBody').innerHTML=`<div class="material-intro"><strong>읽을 자료와 AI 첨부를 따로 선택하세요</strong><p>목록의 자료를 읽은 뒤, 오른쪽 ‘AI에 함께 전달’에서 선택하세요. PDF의 이미지·도표 자체는 AI에 전달되지 않습니다.</p><label class="upload-label">이 문항에 자료 추가<input id="examUpload" type="file" accept=".pdf,.csv,.txt,.md" multiple ${editable()?'':'disabled'}></label><span id="examUploadStatus" role="status" class="small-note"></span></div>`+p.files.map((f,i)=>fileCard(f,i)).join('');
  $('examUpload').onchange=()=>uploadMaterials($('examUpload'),p.id,'examUploadStatus');
}
function renderAttachmentBudget(){
  const q=current(),p=problems[session.current],limit=session.config.attachmentTokenLimit??Math.min(3072,session.config.inputTokenLimit??4096);
  const selected=p.files.filter(f=>q.attachments.includes(f.name)),tokens=selected.reduce((n,f)=>n+(f.tokens??0),0),over=tokens>limit;
  $('attachmentBudget').textContent=`첨부 ${selected.length}개 · ${tokens.toLocaleString()} / ${limit.toLocaleString()}토큰${over?' · 한도 초과 — 자료 선택을 줄이세요':` · 잔여 ${(limit-tokens).toLocaleString()}토큰`}`;
  $('attachmentBudget').classList.toggle('over',over);$('attachmentProgress').max=limit||1;$('attachmentProgress').value=Math.min(tokens,limit||1);
  return over;
}
async function uploadMaterials(input,problemId,statusId){
  const files=[...input.files];input.disabled=true;
  let added=0;
  try{
    for(const file of files){
      if(file.size>10*1024*1024)throw new Error(`${file.name}: 파일당 최대 10MB입니다.`);
      $(statusId).textContent=`${file.name} 분석 중…`;
      const base64=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result.split(',')[1]);reader.onerror=reject;reader.readAsDataURL(file);});
      const result=await api('materials',{problemId,name:file.name,base64});problems=result.problems;boot.catalog=result.catalog;added++;
    }
    $(statusId).textContent=`${added}개 추가 완료. AI 첨부는 별도로 선택하세요.`;
    if(statusId==='uploadStatus')renderLibrary();
    else {await queueSave();renderQuestion();renderState();toast(`${added}개 자료 추가 완료. AI에 보낼 자료를 선택하세요.`);}
  }catch(error){toast(error.message);$(statusId).textContent=`${added}개 추가됨 · ${error.message}`;if(statusId==='uploadStatus')renderLibrary();else if(added){renderQuestion();renderState();}}
  finally{input.disabled=false;input.value='';}
}
$('materialQuestion').onchange=renderLibrary;
$('setupUpload').onchange=()=>uploadMaterials($('setupUpload'),$('materialQuestion').value,'uploadStatus');

function updateSelectionSummary(){
  const ids=[...$('problemList').querySelectorAll('[data-choose-problem]:checked')].map(el=>el.dataset.chooseProblem);
  const selected=(boot.catalog||problems).filter(p=>ids.includes(p.id));
  $('selectedCount').textContent=selected.length;$('selectedPoints').textContent=selected.reduce((n,p)=>n+p.points,0);$('selectedMinutes').textContent=selected.reduce((n,p)=>n+p.minutes,0);
}
$('problemList').onchange=updateSelectionSummary;
