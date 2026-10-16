import {randomUUID} from 'node:crypto';
import {buildContext} from './core.mjs';
import {AppError} from './errors.mjs';
import {tokenLimits,TOKENIZER} from './tokens.mjs';
import {executeContext} from './bounded-runner.mjs';

export const DEMO_CASES = [
  {id:'arithmetic',name:'계산과 응답 형식',material:'곱셈 문제: 17 × 23',prompt:'곱셈 결과를 숫자만 답하세요.',mockResponse:'391',expect:{equals:'391'}},
  {id:'grounding',name:'제공 자료에 근거한 답',material:'가상 문서의 승인 상태: J17=승인, J18=미승인.',prompt:'승인된 작업 ID만 답하세요.',mockResponse:'J17',expect:{equals:'J17',notContains:['J18']}},
  {id:'input-overflow',name:'입력 초과 시 호출 차단',material:'테스트 입력 자료',prompt:'현재 자료를 한 문장으로 요약하세요.',inputTokenLimit:128,mockResponse:'호출되면 안 됩니다.',expect:{blocked:true}},
  {id:'output-overflow',name:'긴 답변의 토큰 제한',modes:['mock'],material:'응답 길이 제어 검사',prompt:'제공 가능한 범위까지 설명하세요.',mockResponse:'한글과 이모지 🙂를 포함한 긴 검증 답변입니다. '.repeat(100),outputTokenLimit:32,expect:{truncated:true}},
  {id:'history-window',name:'이전 문답 2회만 포함',modes:['mock'],material:'현재 자료',prompt:'현재 질문에만 답하세요.',history:[{question:'첫 번째',answer:'답변 1'},{question:'두 번째',answer:'답변 2'},{question:'세 번째',answer:'답변 3'}],mockResponse:'현재 질문의 답변입니다.',expect:{includedTurns:2,droppedTurns:1}}
];
const checkText=(s,name,max=20000)=>{if(typeof s!=='string'||s.length>max)throw new AppError(`${name}은 ${max.toLocaleString()}자 이하의 문자열이어야 합니다.`);};
export function validateHarness(spec={}) {
  if(!['mock','live'].includes(spec.mode??'mock'))throw new AppError('실행 모드를 확인하세요.');
  const mode=spec.mode??'mock', repetitions=Number(spec.repetitions??1),limits=tokenLimits(spec);
  if(!Number.isInteger(repetitions)||repetitions<1||repetitions>3)throw new AppError('반복 횟수는 1~3회입니다.');
  const cases=spec.cases??DEMO_CASES;
  if(!Array.isArray(cases)||!cases.length||cases.length>10)throw new AppError('테스트 사례는 1~10개여야 합니다.');
  const ids=new Set();
  for(const c of cases){
    if(!c||typeof c!=='object')throw new AppError('사례 형식을 확인하세요.');
    checkText(c.id,'사례 ID',80);if(!c.id||ids.has(c.id))throw new AppError('사례 ID는 비어 있거나 중복될 수 없습니다.');ids.add(c.id);
    checkText(c.name??c.id,'사례 이름',150);checkText(c.material??'','자료',100000);checkText(c.prompt,'프롬프트',10000);
    if(!c.prompt.trim())throw new AppError('프롬프트가 비어 있습니다.');
    if(c.modes!==undefined&&(!Array.isArray(c.modes)||c.modes.some(m=>!['mock','live'].includes(m))))throw new AppError('사례 modes는 mock/live 배열이어야 합니다.');
    if(c.mockResponse!==undefined)checkText(c.mockResponse,'모의 답변',100000);
    tokenLimits({...limits,...(c.inputTokenLimit!==undefined?{inputTokenLimit:c.inputTokenLimit}:{}),...(c.outputTokenLimit!==undefined?{outputTokenLimit:c.outputTokenLimit}:{})});
    if(c.history!==undefined&&(!Array.isArray(c.history)||c.history.length>10))throw new AppError('이전 문답은 최대 10쌍입니다.');
    for(const h of c.history??[]){checkText(h.question,'이전 질문');checkText(h.answer,'이전 답변');}
    const e=c.expect??{};if(typeof e!=='object'||Array.isArray(e))throw new AppError('expect는 객체여야 합니다.');
    const allowed=['equals','contains','notContains','json','blocked','truncated','includedTurns','droppedTurns'];
    for(const key of Object.keys(e))if(!allowed.includes(key))throw new AppError(`지원하지 않는 검증 항목: ${key}`);
    if(e.equals!==undefined)checkText(e.equals,'기대 답',20000);
    for(const key of ['contains','notContains'])if(e[key]!==undefined){if(!Array.isArray(e[key])||e[key].length>30)throw new AppError(`${key}는 최대 30개의 문자열 배열이어야 합니다.`);e[key].forEach(s=>checkText(s,key));}
    for(const key of ['json','blocked','truncated'])if(e[key]!==undefined&&typeof e[key]!=='boolean')throw new AppError(`${key}는 true/false여야 합니다.`);
    for(const key of ['includedTurns','droppedTurns'])if(e[key]!==undefined&&(!Number.isInteger(e[key])||e[key]<0))throw new AppError(`${key}는 0 이상의 정수여야 합니다.`);
  }
  if(!cases.some(c=>!c.modes||c.modes.includes(mode)))throw new AppError('선택한 실행 모드에 해당하는 사례가 없습니다.');
  return {mode,repetitions,...limits,cases,historyTurns:spec.historyTurns===0?0:2};
}
function evaluate(expect,result,context) {
  const checks=[],add=(name,passed)=>checks.push({name,passed});
  add('입력 한도',context.tokens<=context.limit);add('표시 답변 한도',result.output.deliveredTokens<=result.output.limit);
  add('답변 존재',result.text.trim().length>0);
  if(expect.blocked===true)add('입력 차단 예상',false);
  if(expect.equals!==undefined)add('정확한 답 일치',result.text.trim()===expect.equals.trim());
  for(const text of expect.contains??[])add(`포함: ${text}`,result.text.includes(text));
  for(const text of expect.notContains??[])add(`제외: ${text}`,!result.text.includes(text));
  if(expect.json){try{JSON.parse(result.text);add('유효한 JSON',true);}catch{add('유효한 JSON',false);}}
  if(expect.truncated!==undefined)add('답변 잘림 여부',result.output.truncated===expect.truncated);
  for(const key of ['includedTurns','droppedTurns'])if(expect[key]!==undefined)add(key,context[key]===expect[key]);
  return checks;
}
export async function runHarness(raw, {runner,signal,onProgress=()=>{}}={}) {
  const spec=validateHarness(raw),cases=spec.cases.filter(c=>!c.modes||c.modes.includes(spec.mode));
  const report={schemaVersion:1,id:randomUUID(),mode:spec.mode,model:spec.mode==='live'?(process.env.CODEX_EXAM_MODEL||'CLI default (not pinned)'):null,startedAt:new Date().toISOString(),finishedAt:null,status:'running',tokenizer:TOKENIZER,config:{inputTokenLimit:spec.inputTokenLimit,outputTokenLimit:spec.outputTokenLimit,repetitions:spec.repetitions,historyTurns:spec.historyTurns},total:cases.length*spec.repetitions,results:[],summary:null};
  onProgress(report);
  for(let repeat=1;repeat<=spec.repetitions;repeat++)for(const c of cases){
    if(signal?.aborted)break;
    const start=performance.now(),entry={caseId:c.id,name:c.name??c.id,repeat,mode:spec.mode,status:'failed',context:null,response:null,checks:[],error:null};
    try{
      const limits=tokenLimits({inputTokenLimit:c.inputTokenLimit??spec.inputTokenLimit,outputTokenLimit:c.outputTokenLimit??spec.outputTokenLimit});
      const question={includeProblem:true,attachments:[],messages:(c.history??[]).flatMap(h=>[{role:'user',text:h.question,status:'complete'},{role:'assistant',text:h.answer,status:'complete'}])};
      const context=buildContext({markdown:c.material??'',files:[]},question,c.prompt,{...limits,historyTurns:spec.historyTurns});
      entry.context={...context,input:undefined,instructions:undefined};
      // Expectations and mock answers never enter the live model's input.
      const mock=async()=>({text:c.mockResponse??'모의 답변',usage:null});
      entry.response=await executeContext(context,{runner:spec.mode==='mock'?mock:runner,signal});
      entry.checks=evaluate(c.expect??{},entry.response,context);
      entry.status=entry.checks.every(ch=>ch.passed)?'passed':'failed';
    }catch(error){
      entry.error=error.message;
      if(signal?.aborted){entry.status='cancelled';}
      else if(error.status===413 && c.expect?.blocked===true){entry.status='passed';entry.checks=[{name:'입력 초과 요청 사전 차단',passed:true}];}
      else entry.checks=[{name:'정상 실행 또는 예상한 입력 차단',passed:false}];
    }
    entry.elapsedMs=Math.round(performance.now()-start);report.results.push(entry);onProgress(report);
  }
  report.status=signal?.aborted?'cancelled':'completed';report.finishedAt=new Date().toISOString();
  const responses=report.results.filter(r=>r.response),usages=responses.map(r=>r.response.usage).filter(Boolean);
  const sumUsage=key=>usages.every(u=>Number.isFinite(u[key]))?usages.reduce((n,u)=>n+u[key],0):null;
  report.summary={passed:report.results.filter(r=>r.status==='passed').length,failed:report.results.filter(r=>r.status==='failed').length,cancelled:report.results.filter(r=>r.status==='cancelled').length,skipped:report.total-report.results.length,avgLatencyMs:responses.length?Math.round(responses.reduce((n,r)=>n+r.response.elapsedMs,0)/responses.length):null,deliveredOutputTokens:responses.reduce((n,r)=>n+r.response.output.deliveredTokens,0),providerUsage:usages.length?{reportedRequests:usages.length,inputTokens:sumUsage('input_tokens'),outputTokens:sumUsage('output_tokens')}:null};
  onProgress(report);return report;
}
export function reportMarkdown(report) {
  return `# 테스트 하네스 결과\n\n- 모드: ${report.mode==='mock'?'모의 실행 (모델 성능 검증 아님)':'실제 Codex CLI'}\n- 상태: ${report.status}\n- 기준 토크나이저: ${report.tokenizer}\n- 입력 한도: ${report.config.inputTokenLimit}\n- 표시 답변 한도: ${report.config.outputTokenLimit} (생성/과금 한도 아님)\n- 통과: ${report.summary?.passed??0} / ${report.total}\n\n| 사례 | 반복 | 결과 | 시간(ms) | 입력 토큰 | 표시/원본 답변 토큰 |\n|---|---:|---|---:|---:|---:|\n`+report.results.map(r=>`| ${r.caseId.replace(/[|\r\n]/g,' ')} | ${r.repeat} | ${r.status} | ${r.elapsedMs} | ${r.context?.tokens??'—'} | ${r.response?`${r.response.output.deliveredTokens}/${r.response.output.originalTokens}`:'—'} |`).join('\n')+'\n\n'+report.results.map(r=>`## ${r.caseId} · ${r.repeat}\n\n${r.error??''}\n\n${r.response?.text??''}\n\n${r.checks.map(c=>`- ${c.passed?'PASS':'FAIL'}: ${c.name}`).join('\n')}`).join('\n\n');
}
