import test from 'node:test';
import assert from 'node:assert/strict';
import {generateProblem,validateProblem,selectProblems,authorSpec,AUTHOR_SCHEMA} from '../author.mjs';
import {makeArgs} from '../codex.mjs';
export const exampleProblem={title:'가상 데이터 검증',category:'자료 분석',minutes:25,points:25,markdown:'# 가상 데이터 검증\n'+('검증용 자료 sample.csv를 읽고 수치와 단위를 비교하여 근거를 작성하세요. '.repeat(5)),files:[{name:'sample.csv',text:'id,value\nA,10\nB,20'}]};
exampleProblem.answerKey={referenceAnswer:'비공개 정답',explanation:'비공개 풀이',criteria:[{id:'C1',label:'자료 검증',maxPoints:25,expected:'수치 검증',partialCredit:'정확한 근거에 부분점수'}]};
test('author uses exactly Astra high and a schema, ignoring exam-model defaults',async()=>{
  let options,prompt;const result=await generateProblem({topic:'검증용 문제'},{runner:async(p,o)=>{prompt=p;options=o;return {text:JSON.stringify(exampleProblem),usage:{input_tokens:10,output_tokens:20}};}});
  assert.equal(options.model,'gpt-6-astra');assert.equal(options.reasoningEffort,'high');assert.equal(options.outputSchema,AUTHOR_SCHEMA);assert.match(prompt,/검증용 문제/);assert.ok(result.problem.files[0].tokens>0);
  assert.equal(result.problem.answerKey,undefined);assert.equal(result.answerKey.referenceAnswer,'비공개 정답');assert.match(options.instructions,/비공개 answerKey/);
  const args=makeArgs('C:/temp',{model:options.model,reasoningEffort:options.reasoningEffort,outputSchemaPath:'C:/temp/schema.json'});
  assert.equal(args[args.indexOf('--model')+1],'gpt-6-astra');assert.ok(args.includes('model_reasoning_effort="high"'));assert.ok(args.includes('--output-schema'));
});
test('invalid author output, traversal, mismatched requests and provider errors never become problems',async()=>{
  assert.throws(()=>authorSpec({topic:'x'}));assert.throws(()=>authorSpec({topic:'test',difficulty:'anything'}));
  assert.throws(()=>validateProblem({...exampleProblem,files:[{name:'../x.csv',text:'x'}]}));
  assert.throws(()=>validateProblem({...exampleProblem,files:[{name:'x.pdf',text:'pdf'}]}));
  assert.throws(()=>validateProblem({...exampleProblem,files:[]}));
  const clean=validateProblem({...exampleProblem,answerKey:'secret',id:'Q1'});assert.equal(clean.answerKey,undefined);assert.equal(clean.id,undefined);
  await assert.rejects(generateProblem({topic:'test'},{runner:async()=>({text:'not JSON'})}),/JSON/);
  await assert.rejects(generateProblem({topic:'test',minutes:20},{runner:async()=>({text:JSON.stringify(exampleProblem)})}),/요청과 다릅니다/);
  await assert.rejects(generateProblem({topic:'test'},{runner:async()=>{throw new Error('model unavailable');}}),/model unavailable/);
});
test('exam selection preserves requested order and rejects empty, duplicate or unknown IDs',()=>{
  const bank=[{id:'Q1'},{id:'G-test'}];assert.deepEqual(selectProblems(bank,['G-test','Q1']),[bank[1],bank[0]]);
  for(const ids of [[],['Q1','Q1'],['missing']])assert.throws(()=>selectProblems(bank,ids));
});
