// Explicit live smoke test: consumes one Astra High generation; creates isolated demo state.
import {mkdirSync,writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';
import {generateProblem} from '../author.mjs';
import {AssessmentStore} from '../assessment-store.mjs';
import {createSession} from '../core.mjs';
const dir=fileURLToPath(new URL(`../.local/grading-demo-${Date.now()}/`,import.meta.url));mkdirSync(dir,{recursive:true});
console.log('LIVE: Astra High로 비공개 정답 포함 검증용 문항 생성 중');
const result=await generateProblem({topic:'자동 채점 검증용 샘플: 불량률 분모 검토',difficulty:'중급',minutes:5,points:5,brief:'매우 짧은 기능 검증용 가상 문항을 만들어라. CSV는 정상 80개·불량 20개 한 로트만 포함한다. AI 초안이 불량률 25%라고 주장한다. 수험자 과제는 (1) 정확한 불량률과 계산식 (2) AI 오류 설명 (3) 재검토 지시문 한 문장이다. 공개 본문은 500자 이내. 비공개 기준은 계산 2점·오류 근거 2점·지시문 1점, 총 5점이다. 제목에 검증용 샘플을 명시한다.'});
const p={...result.problem,id:'G-grading-demo',generatedAt:Date.now()};const store=new AssessmentStore(dir);store.saveDraftKey('live-demo',p,result.answerKey);store.attachDraftKey('live-demo',p.id);
writeFileSync(join(dir,'problem-bank.json'),JSON.stringify([p],null,2));
const session=createSession({mode:'practice',minutes:0,questionLimit:0},[p]);session.questions[0].answer='총 검사 수량은 80+20=100개이고, 불량률은 20/100×100=20%입니다. AI의 25% 주장은 분모를 전체 100개가 아닌 정상 80개로 잘못 사용했기 때문에 틀렸습니다.';
writeFileSync(join(dir,'current.json'),JSON.stringify(session,null,2));console.log(JSON.stringify({stateDir:dir,sessionId:session.id,title:p.title,model:result.model,reasoningEffort:result.reasoningEffort,usage:result.usage}));
