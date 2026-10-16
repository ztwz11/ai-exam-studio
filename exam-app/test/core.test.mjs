import test from 'node:test';
import assert from 'node:assert/strict';
import {createSession,tick,assertRunning,buildContext,usedQuestions,length} from '../core.mjs';
const problems=[{id:'Q1',markdown:'제공된 표만 사용하세요.',files:[{name:'table.csv',text:'x,y\n1,2'}]},{id:'Q2',markdown:'다른 문항의 비밀 자료',files:[]}];
test('deadline survives page reload and caps elapsed at the deadline',()=>{
  const s=createSession({minutes:1},problems,1000);tick(s,21000);assert.equal(s.questions[0].elapsedMs,20000);
  const restored=JSON.parse(JSON.stringify(s));tick(restored,90000);
  assert.equal(restored.status,'submitted');assert.equal(restored.endedAt,61000);assert.equal(restored.questions[0].elapsedMs,60000);
  assert.throws(()=>assertRunning(restored,90001),/종료된/);
});
test('invalid limits are rejected; unlimited is allowed only in practice',()=>{
  assert.throws(()=>createSession({minutes:0},problems),/제한 시간/);
  assert.throws(()=>createSession({questionLimit:0},problems),/질문 제한/);
  assert.throws(()=>createSession({contextLimit:999},problems),/문맥/);
  const s=createSession({mode:'practice',minutes:0,questionLimit:0},problems,1000);tick(s,99999999);assert.equal(s.status,'running');assert.equal(s.deadline,null);
});
test('context contains only current question and selected attachments',()=>{
  const s=createSession({},problems);const q=s.questions[0];
  const c=buildContext(problems[0],q,'분석해 주세요',s.config);assert.match(c.input,/table.csv/);assert.doesNotMatch(c.input,/비밀 자료/);
  q.includeProblem=false;q.attachments=[];
  const bare=buildContext(problems[0],q,'2+2?',s.config);assert.doesNotMatch(bare.input,/제공된 표/);assert.doesNotMatch(bare.input,/table.csv/);
  assert.equal(bare.chars,length(`${bare.instructions}\n\n${bare.input}`));
});
test('oversized material is rejected without silent truncation',()=>{
  const s=createSession({contextLimit:6000},problems);
  assert.throws(()=>buildContext({...problems[0],markdown:'가'.repeat(6000)},s.questions[0],'계산',s.config),/문맥 한도 초과/);
});
test('history is made from complete pairs, newest two only; failed turns excluded',()=>{
  const s=createSession({},problems),q=s.questions[0];
  for(let i=0;i<4;i++)q.messages.push({role:'user',text:`질문${i}`,status:'complete'},{role:'assistant',text:`답${i}`,status:'complete'});
  q.messages.push({role:'user',text:'실패질문',status:'failed'});
  const c=buildContext(problems[0],q,'현재',s.config);
  assert.equal(c.includedTurns,2);assert.equal(c.droppedTurns,2);assert.match(c.input,/질문2/);assert.match(c.input,/질문3/);assert.doesNotMatch(c.input,/질문0|실패질문/);assert.equal(usedQuestions(q),4);
  const independent=buildContext(problems[0],q,'현재',{...s.config,historyTurns:0});assert.equal(independent.includedTurns,0);assert.equal(independent.droppedTurns,4);assert.doesNotMatch(independent.input,/질문[0-3]/);
});
test('old context is removed by whole pairs when the budget is full',()=>{
  const s=createSession({contextLimit:6000},problems),q=s.questions[0];
  q.messages=[{role:'user',text:'이전'.repeat(2000),status:'complete'},{role:'assistant',text:'답'.repeat(2000),status:'complete'}];
  const c=buildContext(problems[0],q,'현재 질문',s.config);assert.equal(c.includedTurns,0);assert.equal(c.droppedTurns,1);assert.ok(c.chars<=6000);
});
test('paused clock does not accumulate question time',()=>{
  const s=createSession({mode:'practice'},problems,1000);tick(s,21000);s.status='paused';tick(s,90000);assert.equal(s.questions[0].elapsedMs,20000);
});
