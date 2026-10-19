import test from 'node:test';
import assert from 'node:assert/strict';
import {createSession,buildContext} from '../core.mjs';
import {ROUND2_ENVIRONMENT,environmentConfig,assertCanAsk,questionUsage} from '../environment.mjs';
import {executeContext} from '../bounded-runner.mjs';
const p={id:'p',markdown:'문제',files:Array.from({length:6},(_,i)=>({name:`${i}.txt`,text:`자료 ${i}`}))};
test('limits count Unicode characters, prompt tokens, and selected files separately',()=>{
  const s=createSession({...ROUND2_ENVIRONMENT,promptCharLimit:3,promptTokenLimit:100},[p]),q=s.questions[0];
  assert.deepEqual(q.attachments,[]);
  assert.doesNotThrow(()=>buildContext(p,q,'🙂가A',s.config));
  assert.throws(()=>buildContext(p,q,'🙂가AB',s.config),/글자 한도/);
  assert.throws(()=>buildContext(p,q,'🙂가A',{...s.config,promptTokenLimit:1}),/토큰 한도/);
  q.attachments=p.files.map(f=>f.name);
  assert.throws(()=>buildContext(p,q,'질문',s.config),/개수 한도/);
  q.attachments=['0.txt'];assert.doesNotThrow(()=>buildContext(p,q,'질문',s.config));
  assert.throws(()=>buildContext({...p,files:[{name:'0.txt',text:'짧은 텍스트',size:2*1024*1024}]},q,'질문',{...s.config,fileSizeLimitMB:1}),/MB 한도/);
  assert.throws(()=>buildContext({...p,files:[{name:'0.txt',text:'PDF',pages:[{},{}]}]},q,'질문',{...s.config,pdfPageLimit:1}),/페이지 한도/);
});
test('ten complete pairs retained, previous attachment payload never replayed',()=>{
  const s=createSession(ROUND2_ENVIRONMENT,[p]),q=s.questions[0];
  for(let i=0;i<12;i++)q.messages.push({role:'user',text:`질문-${i}-끝`,status:'complete',context:{input:'SECRET_OLD_FILE'}},{role:'assistant',text:`답-${i}`,status:'complete'});
  const c=buildContext(p,q,'현재',s.config);
  assert.equal(c.includedTurns,10);assert.equal(c.droppedTurns,2);
  assert.doesNotMatch(c.input,/질문-0-끝|질문-1-끝|SECRET_OLD_FILE|첨부 자료:/);
  assert.match(c.input,/질문-2-끝/);
});
test('global question pool and cooldown survive JSON persistence and question navigation',()=>{
  const s=createSession({...ROUND2_ENVIRONMENT,questionLimit:1},[p,{...p,id:'p2'}]);
  s.questions[0].messages.push({role:'user',status:'complete'});
  assert.equal(questionUsage(s,s.questions[1]),1);assert.throws(()=>assertCanAsk(s,s.questions[1]),/횟수/);
  s.questions[0].messages[0].status='failed';s.nextAskAt=30000;
  const restored=JSON.parse(JSON.stringify(s));
  assert.throws(()=>assertCanAsk(restored,restored.questions[1],29999),/대기/);
  assert.doesNotThrow(()=>assertCanAsk(restored,restored.questions[1],30000));
  assert.equal(createSession(restored.config,[p]).nextAskAt,undefined);
});
test('pinned model and effort reach the runner; response still obeys display cap',async()=>{
  const s=createSession({...ROUND2_ENVIRONMENT,model:'gpt-6-luna',reasoningEffort:'low',outputTokenLimit:32},[p]);
  const c=buildContext(p,s.questions[0],'계산',s.config);
  let received;const result=await executeContext(c,{runner:async(input,options)=>{received=options;return {text:'한글 답변 '.repeat(100)};}});
  assert.equal(received.model,'gpt-6-luna');assert.equal(received.reasoningEffort,'low');assert.ok(result.output.deliveredTokens<=32);
});
test('malformed environment settings rejected without model fallback',()=>{
  for(const config of [{model:'invented'},{reasoningEffort:'fake'},{historyTurns:NaN},{cooldownSeconds:-1},{attachmentFileLimit:21},{fileSizeLimitMB:0},{allowUploads:'false'},{questionLimitScope:'invalid'}])assert.throws(()=>environmentConfig(config));
});
