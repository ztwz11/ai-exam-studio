import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve,sep} from 'node:path';
import {validateAnswerKey,validateGrade,gradeAnswer,gradeSubmission,publicProblem,problemFingerprint,gradeSummary} from '../assessment.mjs';
import {AssessmentStore} from '../assessment-store.mjs';
const p={id:'G-test',title:'합계',category:'계산',minutes:5,points:5,markdown:'가상 자료의 합계를 구하세요.',files:[{name:'x.csv',text:'v\n1\n2'}]};
const key={referenceAnswer:'SECRET_CANARY_3',explanation:'1+2=3',criteria:[{id:'C1',label:'합계',maxPoints:5,expected:'3',partialCredit:'식이 맞으면 2점, 결과도 맞으면 5점'}]};
const grade={criteria:[{id:'C1',points:5,feedback:'합계가 정확합니다.',evidence:'3'}],summary:'잘했습니다.',strengths:['정확한 계산'],improvements:[]};
test('answer key rubric sum and IDs, grade bounds, and quoted evidence are validated',()=>{
  assert.throws(()=>validateAnswerKey(key,6),/배점 합계/);
  assert.throws(()=>validateAnswerKey({...key,criteria:[key.criteria[0],key.criteria[0]]},10),/중복/);
  assert.equal(validateGrade(grade,key,'합계 3').score,5);
  for(const points of [-1,6,NaN,1.3])assert.throws(()=>validateGrade({...grade,criteria:[{...grade.criteria[0],points}]},key,'3'));
  assert.throws(()=>validateGrade(grade,key,'다른 답'),/근거/);
  assert.throws(()=>validateGrade({...grade,criteria:[]},key,'3'),/항목 수/);
});
test('public projection and independent key generation do not expose private keys or student answers',async()=>{
  const exposed=publicProblem({...p,answerKey:key,privateKey:key,files:[{...p.files[0],answerKey:key}]});assert.doesNotMatch(JSON.stringify(exposed),/SECRET_CANARY/);
  let calls=[],saved;
  const result=await gradeSubmission({status:'submitted',questions:[{id:p.id,answer:'3'}]},[p],{getKey:()=>null,saveKey:(id,v)=>{saved=v;},runner:async(input,options)=>{calls.push(JSON.parse(input));assert.equal(options.model,'gpt-6-astra');return {text:JSON.stringify(calls.length===1?key:grade)};}});
  assert.equal(calls[0].studentAnswer,undefined);assert.equal(calls[0].answerKey,undefined);assert.equal(calls[1].studentAnswer,'3');assert.equal(saved.fingerprint,problemFingerprint(p));assert.equal(result.summary.totalScore,5);
});
test('blank answers score zero without inference, errors stay unscored, retry retains successes',async()=>{
  let called=0;const result=await gradeAnswer(p,key,' ',{runner:()=>{called++;}});assert.equal(result.score,0);assert.equal(called,0);
  const session={status:'submitted',questions:[{id:p.id,answer:'3'}]};
  const failed=await gradeSubmission(session,[p],{getKey:()=>({fingerprint:problemFingerprint(p),key}),runner:async()=>{throw new Error('quota');}});
  assert.equal(failed.status,'failed');assert.equal(failed.summary.totalScore,null);assert.equal(failed.results[0].score,undefined);
  const completed={problemId:p.id,status:'complete',score:5,maxPoints:5};
  const retry=await gradeSubmission(session,[p],{previous:[completed],getKey:()=>{throw new Error('should not run');}});assert.equal(retry.summary.totalScore,5);
  await assert.rejects(gradeSubmission({...session,status:'running'},[p],{}),/종료 후/);
  assert.equal(gradeSummary([completed],[p,{...p,id:'other'}]).totalScore,null);
});
test('private store gates running and paused sessions and freezes submitted content',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'exam-grading-unit-'));
  try{
    const store=new AssessmentStore(dir,{runner:async()=>({text:JSON.stringify(grade)})});store.saveDraftKey('draft',p,key);store.attachDraftKey('draft',p.id);
    for(const status of ['running','paused'])assert.throws(()=>store.publicResult({id:'exam-1',status}),/종료 후/);
    const session={id:'exam-1',status:'submitted',questions:[{id:p.id,answer:'3'}]};store.prepare(session,[p]);session.questions[0].answer='tampered';await store.run(session.id);
    assert.equal(store.publicResult(session).summary.totalScore,5);assert.equal(store.publicResult(session).submission,undefined);assert.equal(store.publicResult(session).problems,undefined);
    const restored=new AssessmentStore(dir);assert.equal(restored.publicResult(session).results[0].answerKey.referenceAnswer,'SECRET_CANARY_3');
    assert.match(readFileSync(join(dir,'private','answer-keys.json'),'utf8'),/SECRET_CANARY/);
  }finally{const target=resolve(dir);if(target.startsWith(resolve(tmpdir())+sep+'exam-grading-unit-'))rmSync(target,{recursive:true,force:true});}
});
