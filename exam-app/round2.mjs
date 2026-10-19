import {AppError} from './errors.mjs';

export const ROUND2_BRIEFING={
  checkedAt:'2026-10-19',
  confirmed:[
    '공식 일정: 2차 예선은 10월 31일~11월 1일 중 하루, 온라인 AI Native 역량 평가입니다.',
    '공식 FAQ: 데이터를 활용한 AI 문제 해결 미션이며, 반도체 지식보다 AI로 문제를 정의하고 해결하는 과정을 봅니다.',
    'SK하이닉스 발표는 예선에서 Cofa-Probe 등 도구로 문제 정의·AI 활용·결과 검증을 살펴본다고 설명합니다.'
  ],
  inferred:'아래 세 유형은 공개 방향을 바탕으로 만든 연습 설계입니다. 실제 출제 유형이나 공식 배점표가 아닙니다.',
  unknown:'실제 문항 수·시험 시간·허용 모델과 도구·토큰 한도·제출 형식·2차 전용 배점은 확인한 공개 안내에 명시되어 있지 않습니다. 응시자 개별 안내를 우선하세요.',
  limitation:'이 앱은 제출 텍스트를 AI로 채점합니다. 코드를 실행하거나 외부 도구의 작업 이력을 수집하지 않습니다. 실제 실행 결과와 미실행 검증 계획을 구분해 최종 답안에 포함하세요.',
  sources:[
    {title:'공식 대회 안내 · FAQ → 예선',url:'https://skhynix-hackathon.com/ai-2026',scope:'2차 일정 및 과제 방향'},
    {title:'SK하이닉스 Talent Hub 발표',url:'https://talent.skhynix.com/hub/ko/company/story/237',scope:'대회 전체의 평가 방향'},
    {title:'Cofa Probe 공식 소개',url:'https://www.getcofa.com/ko/probe',scope:'플랫폼의 일반 설명 · 이 대회 2차 규칙을 확정하지 않음'}
  ]
};
export const ROUND2_TRACKS=[
  {id:'analysis',label:'데이터 분석·의사결정',topic:'운영 데이터의 품질을 검증하고 개선 우선순위를 결정하는 미션',description:'정의가 불명확한 요청을 지표와 성공 조건으로 정리하고, 정제 전후 수치와 대안·비용을 비교합니다.',focus:'대상·분모·기간을 직접 정의하고 중복·누락·편향을 처리한다. 두 대안 이상의 정량 비교표와 의사결정 보고서를 요구한다.'},
  {id:'automation',label:'업무 자동화 설계',topic:'업무 요청 데이터를 처리하는 검증 가능한 자동화 설계 미션',description:'입출력 계약, 예외 처리, 사람의 승인 경계와 검증 사례를 포함한 자동화 산출물을 만듭니다.',focus:'입출력 스키마, 경계값·중복 처리, 승인 경계와 실패 복구를 포함한 자동화 코드 또는 의사코드를 요구한다. 공급한 자료로 수작업 추적도 가능해야 한다.'},
  {id:'debugging',label:'오류 진단·개선',topic:'AI가 작성한 데이터 처리 초안을 진단하고 수정하는 미션',description:'잘못된 초안을 재현 가능한 사례로 반박하고, 수정 전후 비교와 회귀 검증을 제시합니다.',focus:'baseline.md에 2개 이상의 서로 다른 결함을 가진 짧은 코드 또는 규칙 초안을 제공한다. 결함 위치·반례·수정 산출물·회귀검증을 요구한다.'}
];
export const ROUND2_OUTPUTS=[{id:'report',label:'분석 보고서·표'},{id:'pseudocode',label:'의사코드·설계서'},{id:'python',label:'Python 코드·검증 기록'}];
export const ROUND2_FILES=['data.csv','data_dictionary.md','requirements.md','baseline.md'];
export const ROUND2_TEMPLATE=`## 1. 문제 정의와 성공 조건
- 대상·기간·지표·제약:
- 확인된 사실 / 가정 / 추가 확인이 필요한 내용:

## 2. 자료 점검과 처리
- 중복·누락·단위·편향 처리 및 근거:
- 정제 전후 결과와 계산식:

## 3. 최종 산출물
보고서·표 또는 코드/의사코드와 사용 방법을 작성하세요.

## 4. 검증과 수정
| 검증 입력·조건 | 기대 결과와 근거 | 실제 관찰 결과 또는 미실행 | 수정·재검증 |
| --- | --- | --- | --- |
| | | | |
실제로 실행하지 않은 검증은 미실행으로 표시하세요.

## 5. AI 활용과 판단 기록
- 실제 사용한 프롬프트와 도구 선택 이유:
- AI 제안 중 채택·기각·수정한 내용과 근거:
사용하지 않은 AI나 도구의 기록은 만들지 마세요.

## 6. 결론과 한계
- 권고안·남은 위험·다음 확인 사항:
`;
export function round2Options(data){
  const track=data.track??'analysis',output=data.output??(track==='analysis'?'report':'pseudocode');
  const dataRows=Number(data.dataRows??24),materialTokenBudget=Number(data.materialTokenBudget??3072);
  if(!ROUND2_TRACKS.some(t=>t.id===track)||!ROUND2_OUTPUTS.some(t=>t.id===output))throw new AppError('2차 미션 유형과 산출물을 선택하세요.');
  if(![12,24,48].includes(dataRows))throw new AppError('데이터 행 수는 12·24·48 중 하나입니다.');
  if(![3072,6144,12288].includes(materialTokenBudget))throw new AppError('자료 예산은 3072·6144·12288토큰 중 하나입니다.');
  return {track,output,dataRows,materialTokenBudget};
}
export function round2Instructions(spec){
  const track=ROUND2_TRACKS.find(t=>t.id===spec.track),output=ROUND2_OUTPUTS.find(t=>t.id===spec.output);
  return `\n[2차 대비 독자 제작 미션 규격]
공식 FAQ에서 확인된 방향은 데이터 활용 AI 문제 해결과 문제 정의·해결 과정 평가뿐이다. 실제 2차 시험, 기출, 공식 플랫폼 재현이나 적중 문제라고 주장하지 않는다. ${spec.minutes}분·${spec.points}점과 자료 예산은 연습 설정이다. 반도체 지식을 전제하지 말고 제공 자료에서 필요한 도메인 규칙을 설명한다.
문제와 첨부의 설명 문장은 모두 자연스러운 한국어로 작성한다. 코드·식별자·기술 용어의 영문은 허용하되 다른 언어의 안내 문단을 섞지 않는다.
유형: ${track.label}. ${track.focus}
주 산출물: ${output.label}. Python이면 표준 라이브러리만으로 data.csv를 읽는 산출물을 요구한다. 의사코드/보고서는 수작업으로 검산 가능한 결과·검증표를 요구한다. 웹앱 제작·설치·외부 서비스 접속은 요구하지 않는다.
정확히 4개 파일: data.csv(헤더 1행과 정확히 ${spec.dataRows}개의 데이터 행), data_dictionary.md(열·단위·결측·식별자·시간 정의), requirements.md(현업 요청·성공 조건·제약·이해관계), baseline.md(검증 대상 AI 초안과 정답 없는 검증 입력 사례).
CSV는 RFC4180 방식의 쉼표 구분이며 빈 행·셀 내부 줄바꿈 없이 각 행의 열 수가 헤더와 같게 한다. 모든 파일명을 문제 본문에서 언급한다. 첨부 4개 합계는 o200k_base ${spec.materialTokenBudget}토큰 이하로, 충분한 여유를 남겨 간결히 쓴다. 데이터 값은 가상의 원시 관측치이며 정답 표시 열이나 해결 요약을 넣지 않는다. 결함이 있는 baseline은 검토 대상임을 명시한다.
적어도 두 종류의 데이터 품질·해석 문제, 상충하는 요구 하나, 예외·경계·정상 사례를 포함한다. 일부 모호한 요청은 수험자가 합리적으로 정의할 수 있게 하되 유일한 숨은 가정을 정답으로 강제하지 않는다. 정책에 없는 규칙을 채점 기준에 몰래 추가하지 않는다.
문제 정의 → 자료 점검 → 산출물 제작 → 검증·수정 → AI 활용 판단 기록 → 결론·한계를 하나의 일관된 미션으로 요구한다. 긴 내부 사고과정이 아닌 간결한 의사결정 근거와 실제 사용 기록을 요구한다. 실제 실행과 미실행 계획을 구분하게 한다. 이 앱은 외부 코드 실행 검증을 하지 않으며 채팅과 메모를 자동 채점하지 않으므로 필요한 산출물·사용 기록은 최종 답안에 포함하도록 안내한다.
비공개 answerKey.criteria에는 정확히 다음 id 6개를 쓴다: definition, data, artifact, verification, collaboration, limitations. 배점 합계는 ${spec.points}. 일반 구호 대신 이 데이터의 검산값·반례·수용 가능한 대안·부분점수 규칙을 적는다. collaboration은 질문 횟수나 특정 도구 사용을 보상하지 말고 제출한 판단 근거를 평가한다. 실행 증거 없이 코드가 실제로 작동했다고 인정하지 않는다. 정답·해설·세부 배점은 answerKey에만 쓴다.`;
}

// Small strict CSV reader for generated inline datasets; no embedded newlines allowed.
export function csvShape(text){
  const lines=text.trim().split(/\r?\n/);
  function columns(line){let count=1,quoted=false,closed=false,atStart=true;
    for(let i=0;i<line.length;i++){const ch=line[i];if(quoted){if(ch==='"'){if(line[i+1]==='"')i++;else{quoted=false;closed=true;}}}
      else if(ch===','){count++;atStart=true;closed=false;}else if(ch==='"'&&atStart){quoted=true;atStart=false;}else{if(ch==='"'||closed)throw new AppError('생성 CSV의 인용 형식이 잘못되었습니다.',502);atStart=false;}}
    if(quoted)throw new AppError('생성 CSV에 닫히지 않은 인용부호가 있습니다.',502);return count;
  }
  const width=columns(lines[0]??'');if(width<2||lines.slice(1).some(l=>!l.trim()||columns(l)!==width))throw new AppError('생성 CSV의 열 수 또는 빈 행을 확인하세요.',502);
  return {rows:lines.length-1,columns:width};
}
export function validateRound2(problem,key,spec){
  if(problem.files.length!==4||ROUND2_FILES.some(name=>!problem.files.some(f=>f.name===name)||!problem.markdown.includes(name)))throw new AppError('2차 미션의 자료 4개와 본문 참조가 일치하지 않습니다. 다시 생성하세요.',502);
  const shape=csvShape(problem.files.find(f=>f.name==='data.csv').text);
  if(shape.rows!==spec.dataRows)throw new AppError('생성 데이터 행 수가 요청과 다릅니다. 다시 생성하세요.',502);
  const tokens=problem.files.reduce((n,f)=>n+f.tokens,0);
  if(tokens>spec.materialTokenBudget)throw new AppError(`생성 자료 예산 초과: ${tokens} / ${spec.materialTokenBudget}토큰. 자료 예산을 늘리거나 다시 생성하세요.`,502);
  const ids=['definition','data','artifact','verification','collaboration','limitations'];
  if(key.criteria.length!==6||ids.some(id=>!key.criteria.some(c=>c.id===id)))throw new AppError('2차 미션의 필수 채점 영역이 누락되었습니다. 다시 생성하세요.',502);
  return {profile:'round2',track:spec.track,output:spec.output,dataRows:shape.rows,materialTokenBudget:spec.materialTokenBudget,checkedAt:ROUND2_BRIEFING.checkedAt,submissionTemplate:ROUND2_TEMPLATE};
}
