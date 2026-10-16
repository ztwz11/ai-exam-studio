import test from 'node:test';
import assert from 'node:assert/strict';
import {runHarness,validateHarness,DEMO_CASES,reportMarkdown} from '../harness.mjs';
test('default mock suite passes without calling the CLI and can repeat',async()=>{
  let called=false;const r=await runHarness({mode:'mock',repetitions:2},{runner:async()=>{called=true;throw new Error('CLI must not run');}});
  assert.equal(called,false);assert.equal(r.results.length,10);assert.equal(r.summary.passed,10);assert.equal(r.summary.failed,0);assert.equal(r.summary.providerUsage,null);
  assert.match(reportMarkdown(r),/모델 성능 검증 아님/);
});
test('live adapter receives no expectation, mock answer, or another case',async()=>{
  let calls=0;
  const r=await runHarness({mode:'live',cases:[{id:'first',prompt:'하나만 답해',material:'자료1',mockResponse:'SECRET_MOCK',expect:{equals:'EXPECTED_SENTINEL'}},{id:'second',prompt:'둘만 답해',material:'자료2',expect:{equals:'2'}}]}, {runner:async(input)=>{calls++;assert.doesNotMatch(input,/SECRET_MOCK|EXPECTED_SENTINEL/);if(calls===1){assert.doesNotMatch(input,/자료2/);return {text:'EXPECTED_SENTINEL'};}assert.doesNotMatch(input,/자료1/);return {text:'2'};}});
  assert.equal(r.summary.passed,2);
});
test('wrong answer and unexpected model errors fail instead of looking successful',async()=>{
  const failed=await runHarness({mode:'mock',cases:[{id:'bad',prompt:'test',mockResponse:'wrong',expect:{equals:'right'}}]});assert.equal(failed.summary.failed,1);
  const error=await runHarness({mode:'live',cases:[{id:'bad',prompt:'test',expect:{blocked:true}}]},{runner:async()=>{throw new Error('offline');}});assert.equal(error.summary.failed,1);
});
test('cancellation stops before any additional calls and keeps partial report',async()=>{
  const controller=new AbortController();let calls=0;
  const r=await runHarness({mode:'live',cases:DEMO_CASES,repetitions:2},{signal:controller.signal,runner:async()=>{calls++;controller.abort();return {text:'391'};}});
  assert.equal(calls,1);assert.equal(r.status,'cancelled');assert.equal(r.summary.cancelled,1);assert.ok(r.summary.skipped>0);
});
test('malformed specifications and unsupported assertions are rejected',()=>{
  for(const spec of [{repetitions:4},{cases:[]},{cases:[{id:'one',prompt:'test',expect:{regex:'(x+)+'}}]},{inputTokenLimit:0},{cases:[{id:'same',prompt:'x'},{id:'same',prompt:'y'}]}])assert.throws(()=>validateHarness(spec));
});
