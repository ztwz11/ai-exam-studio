import test from 'node:test';
import assert from 'node:assert/strict';
import {countTokens,limitAnswer,measureInput,tokenLimits} from '../tokens.mjs';
import {buildContext,createSession} from '../core.mjs';
import {executeContext} from '../bounded-runner.mjs';
const problem={id:'Q1',markdown:'가상 자료입니다.',files:[]};
const question={includeProblem:true,attachments:[],messages:[]};
test('tokenizer counts BPE tokens instead of characters and accepts literal special strings',()=>{
  assert.equal(countTokens('hello world'),2);assert.equal(countTokens(''),0);
  assert.notEqual(countTokens('안녕하세요'),Array.from('안녕하세요').length);
  assert.ok(countTokens('<|endoftext|> 문서 문자열')>0);
});
test('output truncation respects tokens and intact Unicode at every small boundary',()=>{
  const text='한글🙂 테스트 🚀 café é 中文 <|endoftext|> '.repeat(5);
  for(let limit=1;limit<80;limit++){const result=limitAnswer(text,limit);assert.ok(text.startsWith(result.text));assert.ok(countTokens(result.text)<=limit);assert.ok(!result.text.includes('\uFFFD'));assert.equal(result.output.deliveredTokens,countTokens(result.text));}
  assert.equal(limitAnswer('짧은 답',100).output.truncated,false);
});
test('new sessions use token defaults and validate both budgets',()=>{
  const s=createSession({},[problem]);assert.equal(s.config.inputTokenLimit,4096);assert.equal(s.config.outputTokenLimit,1024);
  assert.throws(()=>tokenLimits({inputTokenLimit:127}),/입력 토큰/);assert.throws(()=>tokenLimits({outputTokenLimit:Infinity}),/답변 토큰/);
});
test('exact input boundary includes instructions and preserves current prompt',()=>{
  const full=buildContext(problem,question,'현재 질문',{inputTokenLimit:4096,outputTokenLimit:128,historyTurns:2});
  assert.equal(full.tokens,measureInput(full.input,full.instructions).tokens);
  const exact=buildContext(problem,question,'현재 질문',{inputTokenLimit:full.tokens,outputTokenLimit:128,historyTurns:2});assert.equal(exact.tokens,exact.limit);
  assert.throws(()=>buildContext(problem,question,'현재 질문',{inputTokenLimit:full.tokens-1,outputTokenLimit:128}),error=>error.status===413);
});
test('history is excluded as whole recent pairs under a token budget',()=>{
  const q={...question,messages:[{role:'user',text:'긴 질문 '.repeat(1000),status:'complete'},{role:'assistant',text:'긴 답변 '.repeat(1000),status:'complete'},{role:'user',text:'최근 질문',status:'complete'},{role:'assistant',text:'최근 답변',status:'complete'}]};
  const c=buildContext(problem,q,'현재 질문',{inputTokenLimit:2048,outputTokenLimit:128,historyTurns:2});assert.equal(c.includedTurns,1);assert.equal(c.droppedTurns,1);assert.match(c.input,/최근 질문/);assert.doesNotMatch(c.input,/긴 질문/);
});
test('shared runner blocks excess input before any provider call',async()=>{
  const c=buildContext(problem,question,'현재 질문',{inputTokenLimit:4096,outputTokenLimit:32});let called=false;
  await assert.rejects(executeContext({...c,limit:1},{runner:async()=>{called=true;return {text:'답'};}}),e=>e.status===413);assert.equal(called,false);
});
test('shared runner enforces delivered output while preserving reported provider usage',async()=>{
  const c=buildContext(problem,question,'현재 질문',{inputTokenLimit:4096,outputTokenLimit:32});
  const usage={input_tokens:21000,output_tokens:5000};const r=await executeContext(c,{runner:async()=>({text:'긴 답변 🙂 '.repeat(100),usage})});
  assert.equal(r.output.truncated,true);assert.ok(r.output.deliveredTokens<=32);assert.deepEqual(r.usage,usage);assert.equal(r.output.enforcement,'delivered-text-only');
});
