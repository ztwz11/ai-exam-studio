import http from 'node:http';
import {readFileSync,writeFileSync,mkdirSync,renameSync,existsSync} from 'node:fs';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomBytes} from 'node:crypto';
import {createSession,tick,assertRunning,buildContext,usedQuestions,AppError} from './core.mjs';
import {findCodex} from './codex.mjs';
import {executeContext} from './bounded-runner.mjs';
import {runHarness,validateHarness,DEMO_CASES,reportMarkdown} from './harness.mjs';
import {parseMaterial,materialTokens} from './materials.mjs';
import {generateProblem,authorSpec,selectProblems,AUTHOR_MODEL,AUTHOR_EFFORT} from './author.mjs';
import {AssessmentStore} from './assessment-store.mjs';
import {publicProblem} from './assessment.mjs';

const root=dirname(fileURLToPath(import.meta.url)), source=resolve(root,'..');
const stateDir=process.env.EXAM_STATE_DIR || join(root,'.local');
mkdirSync(stateDir,{recursive:true});
const assessment=new AssessmentStore(stateDir),autoGrade=process.env.EXAM_AUTO_GRADE!=='0';
const stateFile=join(stateDir,'current.json');
const definitions=[
  ['Q1','AI 도입 보고서 검토','데이터 해석 · 의사결정',25,30,['q1_evaluation.csv']],
  ['Q2','자료를 읽는 AI와 실행 권한','문서 분석 · 실행 계획',20,25,[]],
  ['Q3','성공률 100% 집계 검토','코드 검토 · 지표 계산',25,25,['q3_request_snapshots.csv']],
  ['Q4','모델 처리 배분과 자원 한도','최적화 · 제약조건',20,20,['q4_workloads.csv','q4_routes.csv']]
];
const problems=definitions.map(([id,title,category,minutes,points,files])=>({id,title,category,minutes,points,markdown:readFileSync(join(source,'tasks',`${id}.md`),'utf8'),files:files.map(name=>({name,text:readFileSync(join(source,'data',name),'utf8')}))}));
const bankFile=join(stateDir,'problem-bank.json'),draftFile=join(stateDir,'author-draft.json');
const generated=existsSync(bankFile)?JSON.parse(readFileSync(bankFile,'utf8')):[];
problems.push(...structuredClone(generated));
let authorJob=null,authorDraft=existsSync(draftFile)?JSON.parse(readFileSync(draftFile,'utf8')):null;
function persistDraft(){writeFileSync(draftFile+'.tmp',JSON.stringify(authorDraft,null,2));renameSync(draftFile+'.tmp',draftFile);}
if(authorDraft?.status==='running'){authorDraft.status='failed';authorDraft.error='서버가 재시작되어 생성이 중단되었습니다.';persistDraft();}
const libraryFile=join(stateDir,'materials.json'),uploadDir=join(stateDir,'materials');
mkdirSync(uploadDir,{recursive:true});
const library=existsSync(libraryFile)?JSON.parse(readFileSync(libraryFile,'utf8')):[];
for(const p of problems){p.files.forEach(f=>{f.kind??='csv';f.tokens=materialTokens(f);});p.files.push(...library.filter(f=>f.problemId===p.id));}
let uploading=false;
let session=null,busy=null;
let harnessJob=null,harnessReport=null;
if(existsSync(stateFile)) {
  try { session=JSON.parse(readFileSync(stateFile,'utf8'));for(const q of session.questions){for(const m of q.messages){if(m.status==='pending'){m.status='failed';m.error='서버가 재시작되어 요청이 중단되었습니다.';}}}tick(session); }
  catch { throw new Error('저장된 시험 기록을 읽을 수 없습니다. .local/current.json을 보존한 뒤 점검하세요.'); }
}
function persist(){if(!session)return;writeFileSync(stateFile+'.tmp',JSON.stringify(session,null,2),'utf8');renameSync(stateFile+'.tmp',stateFile);}
if(session)persist();
const token=randomBytes(24).toString('hex');
const port=Number(process.env.PORT || 4318);
function sessionProblems(){return session?session.questions.map(q=>problems.find(p=>p.id===q.id)):problems;}
function queueAssessment(){if(autoGrade&&session?.status==='submitted')assessment.prepare(session,sessionProblems());}
function snapshot(){const previous=session?.status;tick(session);if(previous!==session?.status){busy?.controller.abort();persist();}queueAssessment();return {session,problems:sessionProblems().map(publicProblem),serverNow:Date.now(),busy:busy?{question:busy.question,startedAt:busy.startedAt}:null};}
function publicAuthorDraft(){if(!authorDraft)return null;const {id,status,startedAt,finishedAt,spec,model,reasoningEffort,usage,elapsedMs,problemId,error}=authorDraft;return {id,status,startedAt,finishedAt,spec,model,reasoningEffort,usage,elapsedMs,problemId,error,problem:authorDraft.problem?publicProblem(authorDraft.problem):null,hasAnswerKey:assessment.hasDraftKey(id)};}
async function body(req,maxBytes=600000){const chunks=[];let bytes=0;for await(const chunk of req){bytes+=chunk.length;if(bytes>maxBytes)throw new AppError('입력이 너무 큽니다.',413);chunks.push(chunk);}try{return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');}catch{throw new AppError('잘못된 요청 형식입니다.');}}
function active(data){if(data.sessionId!==session?.id)throw new AppError('다른 시험이 시작되었습니다. 화면을 새로고침하세요.',409);snapshot();assertRunning(session);}
function questionAt(index){if(!Number.isInteger(index)||index<0||index>=(session?.questions.length??0))throw new AppError('문항 번호가 잘못되었습니다.');return session.questions[index];}
function updateQuestion(q,data){
  for(const field of ['answer','notes','draft'])if(field in data){if(typeof data[field]!=='string'||data[field].length>100000)throw new AppError('답안은 항목당 100,000자 이하로 작성하세요.');q[field]=data[field];}
  for(const field of ['flagged','done','includeProblem'])if(field in data)q[field]=!!data[field];
  if('attachments'in data){const allowed=problems.find(p=>p.id===q.id).files.map(f=>f.name);if(!Array.isArray(data.attachments)||data.attachments.some(f=>!allowed.includes(f)))throw new AppError('잘못된 첨부입니다.');q.attachments=[...new Set(data.attachments)];}
}
const server=http.createServer(async(req,res)=>{
  const headers={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'self'; base-uri 'none'"};
  const send=(status,data,type='application/json; charset=utf-8')=>{res.writeHead(status,{...headers,'Content-Type':type});res.end(type.startsWith('application/json')?JSON.stringify(data):data);};
  try{
    const host=req.headers.host;
    if(![`127.0.0.1:${port}`,`localhost:${port}`].includes(host))throw new AppError('로컬 접속만 허용합니다.',403);
    const path=new URL(req.url,`http://${host}`).pathname;
    if(path.startsWith('/api/') && req.method!=='GET'){
      if(req.headers['x-exam-token']!==token)throw new AppError('화면을 새로고침한 뒤 다시 시도하세요.',403);
      if(req.headers.origin && req.headers.origin!==`http://${host}`)throw new AppError('다른 사이트에서 보낸 요청은 허용하지 않습니다.',403);
      if(!req.headers['content-type']?.startsWith('application/json'))throw new AppError('JSON 요청이 필요합니다.',415);
    }
    if(req.method==='GET' && path==='/api/bootstrap')return send(200,{...snapshot(),token,catalog:problems.map(publicProblem),connection:{kind:'codex-cli',model:process.env.CODEX_EXAM_MODEL || 'Codex CLI 기본 모델',found:existsSync(findCodex().command)||findCodex().command==='codex'}});
    if(req.method==='GET' && path==='/api/author')return send(200,{running:!!authorJob,draft:publicAuthorDraft(),model:AUTHOR_MODEL,reasoningEffort:AUTHOR_EFFORT,catalog:problems.map(({id,title,points,minutes,generatedAt})=>({id,title,points,minutes,generatedAt}))});
    if(req.method==='GET' && path==='/api/grading'){
      const requested=new URL(req.url,`http://${host}`).searchParams.get('sessionId');
      if(requested!==session?.id)throw new AppError('현재 시험의 결과만 조회할 수 있습니다.',403);
      snapshot();if(!autoGrade)throw new AppError('자동 채점이 비활성화된 테스트 서버입니다.',409);
      return send(200,assessment.publicResult(session));
    }
    if(req.method==='POST' && path==='/api/grading/retry'){
      const data=await body(req);if(data.sessionId!==session?.id)throw new AppError('시험 ID가 다릅니다.',403);
      assessment.retry(session);return send(202,{ok:true});
    }
    if(req.method==='POST' && path==='/api/author/generate'){
      const data=await body(req);
      if(authorJob||busy||harnessJob||assessment.active)throw new AppError('진행 중인 AI 요청이나 채점을 마친 뒤 생성하세요.',409);
      if(problems.length>=50)throw new AppError('문제 은행은 최대 50문항입니다.');
      const spec=authorSpec(data),controller=new AbortController(),id=crypto.randomUUID();
      authorDraft={id,status:'running',startedAt:Date.now(),spec,model:AUTHOR_MODEL,reasoningEffort:AUTHOR_EFFORT};persistDraft();authorJob={controller};
      generateProblem(spec,{signal:controller.signal}).then(result=>{
        const {answerKey,...publicResult}=result;
        if(!controller.signal.aborted)assessment.saveDraftKey(id,result.problem,answerKey);
        authorDraft={...authorDraft,...publicResult,status:controller.signal.aborted?'cancelled':'ready',finishedAt:Date.now()};
      }).catch(error=>{authorDraft={...authorDraft,status:controller.signal.aborted?'cancelled':'failed',error:error.message,finishedAt:Date.now()};}).finally(()=>{authorJob=null;persistDraft();});
      return send(202,{id});
    }
    if(req.method==='POST' && path==='/api/author/cancel'){await body(req);authorJob?.controller.abort();return send(200,{ok:true});}
    if(req.method==='POST' && path==='/api/author/add'){
      const data=await body(req);
      if(data.draftId!==authorDraft?.id)throw new AppError('초안이 변경되었습니다. 다시 확인하세요.',409);
      if(authorDraft.status==='added')return send(200,{problemId:authorDraft.problemId});
      if(authorDraft.status!=='ready'||authorJob)throw new AppError('완료된 초안을 먼저 확인하세요.',409);
      if(problems.length>=50)throw new AppError('문제 은행은 최대 50문항입니다.');
      const existing=generated.find(p=>p.sourceDraftId===data.draftId);
      const p=existing??{...authorDraft.problem,id:`G-${crypto.randomUUID()}`,generatedAt:Date.now(),sourceDraftId:data.draftId,model:AUTHOR_MODEL,reasoningEffort:AUTHOR_EFFORT};
      assessment.attachDraftKey(data.draftId,p.id);
      if(!existing){const next=[...generated,p];writeFileSync(bankFile+'.tmp',JSON.stringify(next,null,2));renameSync(bankFile+'.tmp',bankFile);generated.push(p);problems.push(structuredClone(p));}
      authorDraft.status='added';authorDraft.problemId=p.id;persistDraft();return send(200,{problemId:p.id});
    }
    if(req.method==='GET' && path==='/api/session')return send(200,snapshot());
    if(req.method==='GET' && path.startsWith('/api/material/')){
      const file=library.find(f=>f.id===path.slice('/api/material/'.length));
      if(!file)throw new AppError('자료를 찾을 수 없습니다.',404);
      res.setHeader('Content-Disposition',`attachment; filename*=UTF-8''${encodeURIComponent(file.name)}`);
      return send(200,readFileSync(join(uploadDir,file.id)),file.kind==='pdf'?'application/pdf':'application/octet-stream');
    }
    if(req.method==='POST' && path==='/api/materials'){
      if(uploading||busy||harnessJob)throw new AppError('진행 중인 처리가 끝난 뒤 자료를 추가하세요.',409);
      uploading=true;
      try{
        const data=await body(req,15*1024*1024),problem=problems.find(p=>p.id===data.problemId);
        if(!problem)throw new AppError('자료를 사용할 문항을 선택하세요.');
        if(library.filter(f=>f.problemId===problem.id).length>=20)throw new AppError('문항당 업로드 자료는 최대 20개입니다.');
        if(problem.files.some(f=>f.name===data.name?.trim()))throw new AppError('같은 이름의 자료가 있습니다. 파일 이름을 바꿔 추가하세요.');
        const {file,bytes}=await parseMaterial(data.name,data.base64);
        Object.assign(file,{id:crypto.randomUUID(),problemId:problem.id});
        writeFileSync(join(uploadDir,file.id),bytes);
        const next=[...library,file];writeFileSync(libraryFile+'.tmp',JSON.stringify(next));renameSync(libraryFile+'.tmp',libraryFile);
        library.push(file);problem.files.push(file);
        return send(201,{file,problems:sessionProblems().map(publicProblem),catalog:problems.map(publicProblem)});
      }finally{uploading=false;}
    }
    if(req.method==='GET' && path==='/api/harness')return send(200,{running:!!harnessJob,report:harnessReport,cases:DEMO_CASES});
    if(req.method==='POST' && path==='/api/harness/run'){
      const data=await body(req);snapshot();
      if(busy||harnessJob||authorJob||assessment.active||session&&['running','paused'].includes(session.status))throw new AppError('진행 중인 시험이나 AI 작업을 마친 뒤 하네스를 실행하세요.',409);
      const spec=validateHarness(data),controller=new AbortController();harnessJob={controller};
      runHarness(spec,{signal:controller.signal,onProgress:report=>{harnessReport=report;}}).then(report=>{
        const dir=join(stateDir,'harness');mkdirSync(dir,{recursive:true});
        writeFileSync(join(dir,`harness-${report.id}.json`),JSON.stringify(report,null,2));
        writeFileSync(join(dir,`harness-${report.id}.md`),reportMarkdown(report));
      }).catch(error=>{if(harnessReport){harnessReport.status='failed';harnessReport.error=error.message;}}).finally(()=>{harnessJob=null;});
      return send(202,{running:true});
    }
    if(req.method==='POST' && path==='/api/harness/cancel'){await body(req);harnessJob?.controller.abort();return send(200,{ok:true});}
    if(req.method==='POST' && path==='/api/reset'){
      const data=await body(req);
      if(!session||data.sessionId!==session.id)throw new AppError('현재 시험을 확인한 뒤 다시 시도하세요.',409);
      if(busy||harnessJob||authorJob||assessment.active)throw new AppError('진행 중인 AI 요청이나 채점이 끝난 뒤 초기화하세요. AI 응답은 취소 후 다시 시도할 수 있습니다.',409);
      const previous=session;
      const restarted=createSession(previous.config,sessionProblems());
      restarted.questions[0].firstOpenedAt=restarted.startedAt;
      // Keep a local recovery copy; old IDs cannot write into the new attempt.
      writeFileSync(join(stateDir,`${previous.id}.json`),JSON.stringify(previous,null,2));
      session=restarted;persist();return send(200,snapshot());
    }
    if(req.method==='POST' && path==='/api/start'){
      if(busy||harnessJob)throw new AppError('AI 응답이나 하네스 테스트가 끝난 뒤 새 시험을 시작하세요.',409);
      const data=await body(req);snapshot();
      if(session && ['running','paused'].includes(session.status))throw new AppError('진행 중인 시험을 먼저 제출하세요.',409);
      if(autoGrade&&session&&['queued','running'].includes(assessment.load(session.id)?.status))throw new AppError('현재 시험의 자동 채점이 끝난 뒤 새 시험을 시작하세요.',409);
      if(session)writeFileSync(join(stateDir,`${session.id}.json`),JSON.stringify(session,null,2));
      const selected=selectProblems(problems,data.problemIds);
      session=createSession(data,selected);session.questions[0].firstOpenedAt=session.startedAt;persist();return send(200,snapshot());
    }
    if(req.method==='POST' && path==='/api/save'){
      const data=await body(req);active(data);const q=questionAt(data.question);updateQuestion(q,data);
      if(data.navigate!==undefined){questionAt(data.navigate);session.current=data.navigate;session.segmentStart=Date.now();session.questions[data.navigate].firstOpenedAt??=Date.now();}
      persist();return send(200,snapshot());
    }
    if(req.method==='POST' && path==='/api/pause'){
      const data=await body(req);if(data.sessionId!==session?.id)throw new AppError('시험을 확인하세요.',409);snapshot();
      if(session.config.mode!=='practice')throw new AppError('실전 모드에서는 일시정지할 수 없습니다.',409);
      if(session.status==='running'){session.status='paused';session.pausedAt=Date.now();}
      else if(session.status==='paused'){const pause=Date.now()-session.pausedAt;session.pauseMs+=pause;if(session.deadline)session.deadline+=pause;session.pausedAt=null;session.segmentStart=Date.now();session.status='running';}
      else throw new AppError('종료된 시험입니다.',409);
      persist();return send(200,snapshot());
    }
    if(req.method==='POST' && path==='/api/submit'){
      const data=await body(req);if(data.sessionId!==session?.id)throw new AppError('시험을 확인하세요.',409);snapshot();
      if(session.status==='submitted')return send(200,snapshot());
      if(data.question!==undefined)updateQuestion(questionAt(data.question),data);
      session.status='submitted';session.endedAt=Date.now();session.reason='manual';busy?.controller.abort();persist();return send(200,snapshot());
    }
    if(req.method==='POST' && path==='/api/context'){
      const data=await body(req);active(data);const q=questionAt(data.question);
      const copy={...q,attachments:data.attachments??q.attachments,includeProblem:data.includeProblem??q.includeProblem};
      const context=buildContext(problems.find(p=>p.id===q.id),copy,data.prompt,session.config);
      return send(200,{...context,input:context.input});
    }
    if(req.method==='POST' && path==='/api/ask'){
      const data=await body(req);active(data);if(busy||harnessJob||authorJob)throw new AppError('진행 중인 AI 작업이 끝난 뒤 질문하세요.',409);
      const q=questionAt(data.question);updateQuestion(q,data);
      if(session.config.readFirst && q.elapsedMs<120000)throw new AppError('이 문항을 먼저 2분간 읽은 뒤 질문할 수 있습니다.',409);
      if(session.config.questionLimit && usedQuestions(q)>=session.config.questionLimit)throw new AppError('이 문항의 질문 횟수를 모두 사용했습니다.',409);
      const context=buildContext(problems.find(p=>p.id===q.id),q,data.prompt,session.config);
      const message={id:crypto.randomUUID(),role:'user',text:data.prompt.trim(),at:Date.now(),status:'pending',context:{...context,input:undefined,instructions:undefined}};
      q.messages.push(message);q.draft='';
      const controller=new AbortController();busy={question:data.question,startedAt:Date.now(),controller};persist();
      try{
        const result=await executeContext(context,{signal:controller.signal});snapshot();
        if(session.status==='submitted') { message.status='failed';message.error='시험 종료 후 도착한 응답은 사용하지 않습니다.'; }
        else {message.status='complete';q.messages.push({id:crypto.randomUUID(),role:'assistant',text:result.text,at:Date.now(),status:'complete',usage:result.usage,output:result.output,elapsedMs:result.elapsedMs});}
      }catch(error){message.status='failed';message.error=error.message;}
      finally{busy=null;persist();}
      return send(200,snapshot());
    }
    if(req.method==='POST' && path==='/api/cancel'){
      const data=await body(req);if(data.sessionId!==session?.id)throw new AppError('시험을 확인하세요.',409);busy?.controller.abort();return send(200,{ok:true});
    }
    if(req.method==='GET'){
      if(path==='/author')return send(200,readFileSync(join(root,'public','author.html')),'text/html; charset=utf-8');
      if(path==='/author.js')return send(200,readFileSync(join(root,'public','author.js')),'text/javascript; charset=utf-8');
      if(path==='/author.css')return send(200,readFileSync(join(root,'public','author.css')),'text/css; charset=utf-8');
      const files={'/':['index.html','text/html; charset=utf-8'],'/app.js':['app.js','text/javascript; charset=utf-8'],'/style.css':['style.css','text/css; charset=utf-8'],'/harness':['harness.html','text/html; charset=utf-8'],'/harness.js':['harness.js','text/javascript; charset=utf-8'],'/harness.css':['harness.css','text/css; charset=utf-8']};
      if(files[path]){const [file,type]=files[path];return send(200,readFileSync(join(root,'public',file)),type);}
      if(path==='/favicon.ico')return send(204,'','image/x-icon');
    }
    send(404,{error:'찾을 수 없는 경로입니다.'});
  }catch(error){send(error.status || 500,{error:error.status?error.message:'저장 또는 서버 처리에 실패했습니다. 서버 상태를 확인하세요.'});}
});
setInterval(()=>{
  const before=session?.status;tick(session);if(before!==session?.status){busy?.controller.abort();persist();}
  queueAssessment();
  if(autoGrade&&session?.status==='submitted'&&!busy&&!authorJob&&!harnessJob&&!assessment.active)assessment.run(session.id).catch(error=>console.error('채점 기록 저장 실패:',error.message));
},1000).unref();
server.listen(port,'127.0.0.1',()=>console.log(`AI Exam Studio: http://127.0.0.1:${port}\n연결: Codex CLI · 로컬 전용 · Ctrl+C로 종료`));
server.on('error',error=>{console.error(error.code==='EADDRINUSE'?`${port} 포트를 사용 중입니다. 기존 창을 열거나 PORT를 변경하세요.`:error.message);process.exitCode=1;});
process.on('SIGINT',()=>{busy?.controller.abort();harnessJob?.controller.abort();authorJob?.controller.abort();assessment.stop();tick(session);persist();server.close(()=>process.exit(0));});
