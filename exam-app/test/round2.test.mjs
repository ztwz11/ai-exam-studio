import test from 'node:test';
import assert from 'node:assert/strict';
import {authorSpec,generateProblem} from '../author.mjs';
import {csvShape,ROUND2_FILES,ROUND2_TEMPLATE,ROUND2_TRACKS} from '../round2.mjs';
import {publicProblem} from '../assessment.mjs';
const spec={profile:'round2',topic:'검증용 데이터 미션',dataRows:12};
const fixture=()=>({title:'가상 업무 개선 미션',category:'데이터 분석',minutes:90,points:100,
  markdown:'가상 자료로 문제를 정의하고 결과를 검증하세요. '.repeat(5)+ROUND2_FILES.join(' '),
  files:ROUND2_FILES.map((name,i)=>({name,text:i===0?'id,value\n'+Array.from({length:12},(_,n)=>`${n+1},${n*2}`).join('\n'):'가상 규칙과 검토 대상 자료'})),
  answerKey:{referenceAnswer:'PRIVATE_ROUND2_KEY',explanation:'검산한 정답 근거',criteria:['definition','data','artifact','verification','collaboration','limitations'].map((id,i)=>({id,label:id,maxPoints:i===0?25:15,expected:'근거',partialCredit:'제출 근거에 따른 부분점수'}))}
});
test('round2 defaults and explicit settings are validated before any model call',()=>{
  const s=authorSpec(spec);assert.equal(s.minutes,90);assert.equal(s.points,100);assert.equal(s.materialTokenBudget,3072);assert.equal(authorSpec({topic:'일반 문제'}).profile,'general');
  for(const values of [{profile:'other'},{track:'invalid'},{output:'shell'},{dataRows:13},{materialTokenBudget:999},{points:5}])assert.throws(()=>authorSpec({...spec,...values}));
});
test('round2 uses mission-specific instructions for every track, keeps keys private and exposes an empty template',async()=>{
  for(const track of ROUND2_TRACKS){let request;const r=await generateProblem({...spec,track:track.id},{runner:async(prompt,options)=>{request={prompt,options};return {text:JSON.stringify(fixture())};}});
    assert.equal(request.options.model,'gpt-6-astra');assert.equal(request.options.reasoningEffort,'high');assert.match(request.options.instructions,/실제 2차 시험/);assert.ok(request.options.instructions.includes(track.focus));assert.match(request.options.instructions,/최종 답안/);
    assert.equal(r.problem.training.dataRows,12);assert.equal(r.problem.training.submissionTemplate,ROUND2_TEMPLATE);assert.match(r.problem.category,/2차 대비/);assert.equal(r.answerKey.referenceAnswer,'PRIVATE_ROUND2_KEY');
    const safe=publicProblem({...r.problem,answerKey:r.answerKey,training:{...r.problem.training,answerKey:r.answerKey}});assert.doesNotMatch(JSON.stringify(safe),/PRIVATE_ROUND2_KEY/);assert.equal(safe.training.profile,'round2');
  }
});
test('round2 rejects missing materials, inconsistent CSV, budget overflow, and incomplete private rubric',async()=>{
  const reject=async change=>{const p=fixture();change(p);await assert.rejects(generateProblem(spec,{runner:async()=>({text:JSON.stringify(p)})}));};
  await reject(p=>p.files.pop());await reject(p=>p.markdown='자료 검토를 수행하세요. '.repeat(20));
  await reject(p=>p.files[0].text+='\n13,24');await reject(p=>p.files[0].text=p.files[0].text.replace('1,0','1,0,extra'));
  await reject(p=>p.files[1].text='아주 긴 정책 설명입니다. '.repeat(2000));
  await reject(p=>p.answerKey.criteria[0].id='unknown');
  assert.deepEqual(csvShape('id,note\n1,"a,b"\n2,"a""b"'),{rows:2,columns:2});
  assert.throws(()=>csvShape('id,note\n1,"unclosed'));
  assert.throws(()=>csvShape('id,note\n1,"closed"x'));
});
