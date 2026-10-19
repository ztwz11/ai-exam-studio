import {AppError} from './errors.mjs';

// Explicit practice values, never an assertion about the organizer's private settings.
export const EXAM_MODELS = ['gpt-6-astra','gpt-6.1-sol','gpt-6-luna'];
export const EXAM_EFFORTS = ['low','medium','high'];
export const ROUND2_ENVIRONMENT = Object.freeze({
  mode:'exam', minutes:90, questionLimit:80, questionLimitScope:'exam', inputTokenLimit:32768,
  outputTokenLimit:2048, attachmentTokenLimit:20000, historyTurns:10,
  promptCharLimit:1000, promptTokenLimit:4096, attachmentFileLimit:5,
  fileSizeLimitMB:10, pdfPageLimit:100, allowUploads:false,
  cooldownSeconds:30, clearAttachmentsAfterSend:true, restrictCopy:true,
  model:'gpt-6-astra', reasoningEffort:'high', readFirst:false
});
export const ENVIRONMENT_INFO = {
  checkedAt:'2026-10-19', status:'practice-only',
  notice:'프로그래머스 공개 가이드 기반 제한 연습입니다. 하이닉스 2차 적용 여부와 AI 모델은 미확인입니다. 시작 후 설정이 고정됩니다.',
  sources:[{title:'SK하이닉스 AI 해커톤 공식 안내',url:'https://skhynix-hackathon.com/ai-2026'},{title:'SK하이닉스 공식 대회 소개',url:'https://talent.skhynix.com/hub/ko/company/story/237'}],
  evidence:[
    {level:'공개 가이드 색인본',text:'질문 1,000자 · 첨부 20,000토큰 · 최근 10쌍 · 첨부는 이번 질문만 · 전송 후 30초 대기',url:'https://prgrms-ai-user-guide.oopy.io/'},
    {level:'1차 후기 — 2차 규칙 아님',text:'90분·총 80회·파일 5개·GPT-5.2 보고가 있습니다. 10월 17일 글의 “2차”는 2교시와 혼용되어 2차 예선 근거로 사용하지 않습니다.',url:'https://theddari.com/trends/telegram/2622524146/597'},
    {level:'앱 연습값',text:'전체 입력 32,768·프롬프트 4,096·표시 답변 2,048토큰, 10MB/100페이지, Astra High. 실제 시험 모델 성능과 같다는 뜻이 아닙니다.'}
  ],
  models:EXAM_MODELS, efforts:EXAM_EFFORTS, preset:ROUND2_ENVIRONMENT
};
function integer(config,key,fallback,min,max,label) {
  const n=Number(config[key]??fallback);
  if(!Number.isInteger(n)||n<min||n>max)throw new AppError(`${label}: ${min.toLocaleString()}~${max.toLocaleString()} 사이의 정수가 필요합니다.`);
  return n;
}
export function environmentConfig(config={}) {
  const model=config.model??process.env.CODEX_EXAM_MODEL??'gpt-6-astra';
  const reasoningEffort=config.reasoningEffort??'high';
  if(!EXAM_MODELS.includes(model))throw new AppError('지원하는 시험 AI 모델을 선택하세요.');
  if(!EXAM_EFFORTS.includes(reasoningEffort))throw new AppError('추론 수준은 low, medium, high 중 선택하세요.');
  if(config.allowUploads!==undefined&&typeof config.allowUploads!=='boolean')throw new AppError('시험 중 업로드 설정이 잘못되었습니다.');
  if(config.questionLimitScope!==undefined&&!['question','exam'].includes(config.questionLimitScope))throw new AppError('질문 횟수 범위가 잘못되었습니다.');
  for(const key of ['clearAttachmentsAfterSend','restrictCopy'])if(config[key]!==undefined&&typeof config[key]!=='boolean')throw new AppError('시험 환경 설정이 잘못되었습니다.');
  return {
    environmentVersion:1, rulesStatus:'practice-only', model, reasoningEffort,
    promptCharLimit:integer(config,'promptCharLimit',10000,1,10000,'프롬프트 글자 한도'),
    promptTokenLimit:integer(config,'promptTokenLimit',config.inputTokenLimit??4096,1,32768,'프롬프트 토큰 한도'),
    attachmentFileLimit:integer(config,'attachmentFileLimit',20,0,20,'한 요청의 첨부 개수'),
    fileSizeLimitMB:integer(config,'fileSizeLimitMB',10,1,10,'파일당 크기(MB)'),
    pdfPageLimit:integer(config,'pdfPageLimit',100,1,100,'PDF 페이지 한도'),
    allowUploads:config.allowUploads??true,
    questionLimitScope:config.questionLimitScope??'question',
    cooldownSeconds:integer(config,'cooldownSeconds',0,0,300,'질문 전송 간격(초)'),
    clearAttachmentsAfterSend:config.clearAttachmentsAfterSend??false,
    restrictCopy:config.restrictCopy??false,
    historyTurns:integer(config,'historyTurns',2,0,20,'이전 문답 수')
  };
}
export function questionUsage(session,question) {
  const used=q=>q.messages.filter(m=>m.role==='user'&&m.status!=='failed').length;
  return session.config.questionLimitScope==='exam'?session.questions.reduce((n,q)=>n+used(q),0):used(question);
}
export function assertCanAsk(session,question,now=Date.now()) {
  if(session.config.questionLimit&&questionUsage(session,question)>=session.config.questionLimit)throw new AppError('설정된 AI 질문 횟수를 모두 사용했습니다.',409);
  if(now<(session.nextAskAt??0))throw new AppError(`질문 전송 대기: ${Math.ceil((session.nextAskAt-now)/1000)}초 후 다시 전송하세요.`,429);
}
export function assertFileAllowed(file,config={}) {
  const size=file.size??Buffer.byteLength(file.text??'','utf8');
  if(size>(config.fileSizeLimitMB??10)*1024*1024)throw new AppError(`${file.name}: 파일당 ${config.fileSizeLimitMB??10}MB 한도를 초과했습니다.`,413);
  if(file.pages?.length>(config.pdfPageLimit??100))throw new AppError(`${file.name}: PDF ${config.pdfPageLimit??100}페이지 한도를 초과했습니다.`,413);
}
