import {runCodex} from './codex.mjs';
import {AppError} from './errors.mjs';
import {materialTokens} from './materials.mjs';
import {ANSWER_KEY_SCHEMA,validateAnswerKey} from './assessment.mjs';
export const AUTHOR_MODEL='gpt-6-astra',AUTHOR_EFFORT='high';
export const AUTHOR_SCHEMA={type:'object',additionalProperties:false,required:['title','category','minutes','points','markdown','files'],properties:{title:{type:'string'},category:{type:'string'},minutes:{type:'integer'},points:{type:'integer'},markdown:{type:'string'},files:{type:'array',items:{type:'object',additionalProperties:false,required:['name','text'],properties:{name:{type:'string'},text:{type:'string'}}}}}};
AUTHOR_SCHEMA.required.push('answerKey');AUTHOR_SCHEMA.properties.answerKey=ANSWER_KEY_SCHEMA;
const instructions=`당신은 한국어 AI 활용 역량 모의시험 출제자다. 실제 시험·기출·실존 기업의 내부 자료라고 주장하지 말고 가상의 독자 제작 문항 1개를 작성한다. 도구, 파일 접근, 검색, 실행, 다른 에이전트를 사용하지 않는다. 최종 응답은 지정된 JSON 스키마만 따른다. 사용자의 주제와 조건을 반영하되 수험자가 읽는 문제와 자료만 출력한다. 정답, 해설, 풀이, 힌트, 내부 검토 내용은 출력하지 않는다. 문제는 주어진 자료만으로 풀 수 있어야 한다. 수치·단위·제약·상충 자료를 내부적으로 검산하여 의도치 않은 모순과 근거 없는 유일 정답 주장을 피한다. 상황, 자료별 식별자, 수행 과제, 제출 형식, 배점 기준을 명확히 제시한다. 단순 검색이나 요약으로 끝나지 않고 비교·계산·검증·우선순위 판단을 요구한다. 필요하면 가상 로그·정책·표·잘못된 AI 초안을 포함한다. 모든 필요한 수치는 본문 또는 첨부에 있어야 한다. 첨부는 1~4개 UTF-8 CSV/MD/TXT 파일이며 본문에서 정확한 파일명을 참조한다. PDF 바이너리나 base64는 생성하지 않는다. 본문과 첨부의 합계는 가급적 한국어 5,000자 이내로 작성한다.`;
function text(value,name,min,max){if(typeof value!=='string'||value.trim().length<min||value.length>max)throw new AppError(`${name}: ${min}~${max.toLocaleString()}자로 입력하세요.`);return value.trim();}
function integer(value,name,min,max){const n=Number(value);if(!Number.isInteger(n)||n<min||n>max)throw new AppError(`${name}: ${min}~${max} 사이의 정수여야 합니다.`);return n;}
export function authorSpec(data={}){
  const difficulty=data.difficulty??'상급';if(!['중급','상급','최상급'].includes(difficulty))throw new AppError('난이도를 선택하세요.');
  return {topic:text(data.topic,'주제',2,200),brief:text(data.brief??'','추가 요구',0,5000),difficulty,minutes:integer(data.minutes??25,'권장 시간',5,120),points:integer(data.points??25,'배점',1,100)};
}
export function validateProblem(value){
  if(!value||typeof value!=='object'||Array.isArray(value))throw new AppError('생성 결과가 문제 객체가 아닙니다.');
  const title=text(value.title,'문제 제목',2,120),category=text(value.category,'분류',2,120),markdown=text(value.markdown,'문제 본문',100,30000);
  const minutes=integer(value.minutes,'권장 시간',5,120),points=integer(value.points,'배점',1,100);
  if(!Array.isArray(value.files)||value.files.length<1||value.files.length>4)throw new AppError('첨부 자료는 1~4개여야 합니다.');
  const names=new Set();
  const files=value.files.map(f=>{
    const name=text(f?.name,'첨부 이름',1,120);
    if(/[\\/\x00-\x1f]/.test(name)||! /\.(csv|md|txt)$/i.test(name)||names.has(name.toLowerCase()))throw new AppError('첨부 이름 또는 형식이 잘못되었거나 중복됩니다.');
    names.add(name.toLowerCase());const file={name,text:text(f.text,'첨부 내용',1,40000),kind:name.split('.').pop().toLowerCase()};file.tokens=materialTokens(file);return file;
  });
  if(markdown.length+files.reduce((sum,f)=>sum+f.text.length,0)>80000)throw new AppError('문제와 자료의 총 길이가 너무 큽니다.');
  return {title,category,minutes,points,markdown,files};
}
export async function generateProblem(data,{signal,runner=runCodex}={}){
  const spec=authorSpec(data),startedAt=Date.now();
  const privateInstructions=instructions.replace('정답, 해설, 풀이, 힌트, 내부 검토 내용은 출력하지 않는다.','문제 markdown과 files에는 정답, 해설, 풀이, 힌트를 절대 포함하지 않는다. 정답과 해설은 비공개 answerKey에만 작성한다. answerKey.referenceAnswer에는 완전한 모범답안, explanation에는 검산한 풀이와 근거, criteria에는 고유 id·평가 항목 label·정수 배점 maxPoints·필수 정답 요소 expected·부분점수 규칙 partialCredit를 넣는다. criteria 배점 합계는 points와 정확히 같아야 한다. 다른 타당한 논증과 결론도 인정할 기준을 작성한다.').replace('수험자가 읽는 문제와 자료만 출력한다.','수험자가 읽는 문제·자료와 비공개 answerKey를 분리하여 출력한다.');
  const result=await runner(`다음 출제 요구에 맞춰 새 문제 1개와 별도의 비공개 정답·채점 기준을 작성하세요.\n${JSON.stringify(spec)}`,{signal,instructions:privateInstructions+' 공개 markdown/files에는 문항 총배점만 표시하고, 세부 채점 기준·부분점수 규칙·기대 정답 요소는 모두 비공개 answerKey.criteria에만 넣는다.',model:AUTHOR_MODEL,reasoningEffort:AUTHOR_EFFORT,outputSchema:AUTHOR_SCHEMA,timeoutMs:480000});
  let parsed;try{parsed=JSON.parse(result.text);}catch{throw new AppError('모델이 유효한 문제 JSON을 반환하지 않았습니다. 다시 생성하세요.',502);}
  const problem=validateProblem(parsed);
  if(problem.minutes!==spec.minutes||problem.points!==spec.points)throw new AppError('생성된 시간 또는 배점이 요청과 다릅니다. 다시 생성하세요.',502);
  return {problem,answerKey:validateAnswerKey(parsed.answerKey,problem.points),model:AUTHOR_MODEL,reasoningEffort:AUTHOR_EFFORT,usage:result.usage??null,elapsedMs:Date.now()-startedAt,spec};
}
export function selectProblems(catalog,ids){
  if(ids===undefined)return [...catalog];
  if(!Array.isArray(ids)||ids.length<1||ids.length>50||new Set(ids).size!==ids.length)throw new AppError('시험에 포함할 문제를 1~50개 선택하세요.');
  return ids.map(id=>{const p=catalog.find(p=>p.id===id);if(!p)throw new AppError('문제 목록이 변경되었습니다. 새로고침하세요.');return p;});
}
