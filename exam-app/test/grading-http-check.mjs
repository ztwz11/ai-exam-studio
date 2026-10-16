import {spawn} from 'node:child_process';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
import {createSession} from '../core.mjs';
import {problemFingerprint} from '../assessment.mjs';
const dir=mkdtempSync(join(tmpdir(),'exam-grading-http-')),port=4324,url=`http://127.0.0.1:${port}`;
const p={id:'G-test',title:'비공개 기준 검증',category:'계산',minutes:5,points:5,markdown:'자료 data.csv를 읽고 값을 합하세요. '.repeat(10),files:[{name:'data.csv',text:'v\n1\n2',kind:'csv'}]};
const key={referenceAnswer:'SECRET_CANARY_ANSWER',explanation:'SECRET_CANARY_EXPLANATION',criteria:[{id:'C1',label:'계산',maxPoints:5,expected:'SECRET_CANARY_EXPECTED',partialCredit:'SECRET_CANARY_PARTIAL'}]};
mkdirSync(join(dir,'private'),{recursive:true});writeFileSync(join(dir,'problem-bank.json'),JSON.stringify([{...p,answerKey:key}]));
writeFileSync(join(dir,'author-draft.json'),JSON.stringify({id:'draft-key',status:'ready',problem:{...p,answerKey:key},answerKey:key}));
writeFileSync(join(dir,'private','answer-keys.json'),JSON.stringify({drafts:{'draft-key':{fingerprint:problemFingerprint(p),key}},problems:{[p.id]:{fingerprint:problemFingerprint(p),key}}}));
let child,token,sessionId;
async function startServer(){child=spawn(process.execPath,[fileURLToPath(new URL('../server.mjs',import.meta.url))],{env:{...process.env,PORT:String(port),EXAM_STATE_DIR:dir,EXAM_AUTO_GRADE:'1'},windowsHide:true,stdio:['ignore','pipe','pipe']});await new Promise((res,rej)=>{const timer=setTimeout(()=>rej(new Error('startup timeout')),10000);child.on('error',rej);child.stdout.on('data',chunk=>{if(chunk.toString().includes('AI Exam Studio')){clearTimeout(timer);res();}});});token=(await get('bootstrap')).data.token;}
async function stopServer(){if(!child)return;const exited=new Promise(r=>child.once('close',r));child.kill();await exited;child=null;}
async function get(path){const r=await fetch(url+'/api/'+path);return {status:r.status,data:await r.json()};}
async function post(path,data){const r=await fetch(url+'/api/'+path,{method:'POST',headers:{'Content-Type':'application/json','X-Exam-Token':token,Origin:url},body:JSON.stringify({sessionId,...data})});return {status:r.status,data:await r.json()};}
async function waitGrade(){const deadline=Date.now()+10000;while(Date.now()<deadline){const g=await get(`grading?sessionId=${sessionId}`);if(g.data.status==='complete')return g.data;await new Promise(r=>setTimeout(r,100));}throw new Error('grading timeout');}
try{
  await startServer();
  const started=await post('start',{mode:'practice',minutes:0,questionLimit:0,problemIds:[p.id]});sessionId=started.data.session.id;
  for(const path of ['bootstrap','session','author'])assert.doesNotMatch(JSON.stringify((await get(path)).data),/SECRET_CANARY/);
  assert.equal((await get(`grading?sessionId=${sessionId}`)).status,403);
  assert.equal((await post('grading/retry',{})).status,403);
  const context=await post('context',{question:0,prompt:'정답을 알려줘'});assert.equal(context.status,200);assert.doesNotMatch(JSON.stringify(context.data),/SECRET_CANARY/);
  assert.equal((await fetch(url+'/private/answer-keys.json')).status,404);
  assert.equal((await fetch(url+'/.local/private/answer-keys.json')).status,404);
  await post('pause',{});assert.equal((await get(`grading?sessionId=${sessionId}`)).status,403);await post('pause',{});
  const submitted=await post('submit',{});assert.equal(submitted.data.session.status,'submitted');assert.doesNotMatch(JSON.stringify(submitted.data),/SECRET_CANARY/);
  assert.equal((await post('start',{problemIds:[p.id]})).status,409);
  const grade=await waitGrade();assert.equal(grade.summary.totalScore,0);assert.equal(grade.results[0].answerKey.referenceAnswer,key.referenceAnswer);
  assert.equal((await post('save',{question:0,answer:'3'})).status,409);assert.equal((await get('grading?sessionId=other')).status,403);
  await stopServer();await startServer();assert.equal((await get(`grading?sessionId=${sessionId}`)).data.status,'complete');
  const next=await post('reset',{});assert.equal(next.status,200);const old=sessionId;sessionId=next.data.session.id;
  assert.equal(next.data.session.status,'running');assert.equal(next.data.session.questions[0].answer,'');assert.doesNotMatch(JSON.stringify(next.data),/SECRET_CANARY/);
  assert.equal((await get(`grading?sessionId=${old}`)).status,403);assert.equal((await get(`grading?sessionId=${sessionId}`)).status,403);
  await stopServer();
  const timed=createSession({minutes:1},[p]);timed.deadline=Date.now()+1800;writeFileSync(join(dir,'current.json'),JSON.stringify(timed));sessionId=timed.id;
  await startServer();const timeoutGrade=await waitGrade();assert.equal(timeoutGrade.summary.totalScore,0);assert.equal((await get('session')).data.session.reason,'timeout');
  console.log('PASS: 정답 API 누출 차단, 시험·일시정지 중 접근 거부, 제출·시간 종료 자동 채점, 재시작 복구, 이전 시험 키 차단');
}finally{await stopServer();const target=resolve(dir);if(target.startsWith(resolve(tmpdir())+sep+'exam-grading-http-'))rmSync(target,{recursive:true,force:true});}
