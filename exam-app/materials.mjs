import {Worker} from 'node:worker_threads';
import {extname} from 'node:path';
import {countTokens} from './tokens.mjs';
import {AppError} from './errors.mjs';

export const MAX_FILE_BYTES=10*1024*1024;
export function attachmentBudget(config={}) {
  const value=Number(config.attachmentTokenLimit??Math.min(3072,config.inputTokenLimit??4096));
  if(!Number.isInteger(value)||value<0||value>32768)throw new AppError('첨부 한도는 0~32,768토큰입니다. 0은 첨부 불가입니다.');
  if(config.inputTokenLimit!==undefined&&value>config.inputTokenLimit)throw new AppError('첨부 한도는 전체 입력 한도 이하여야 합니다.');
  return value;
}
export const materialTokens=file=>countTokens(`첨부 자료: ${file.name}\n${file.text}`);
export function selectedMaterials(problem,question,config) {
  if(!Array.isArray(question.attachments)||question.attachments.some(name=>!problem.files.some(f=>f.name===name)))throw new AppError('자료 목록에 없는 첨부입니다.');
  const files=problem.files.filter(f=>question.attachments.includes(f.name));
  const tokens=files.reduce((n,f)=>n+materialTokens(f),0),limit=attachmentBudget(config);
  return {files,tokens,limit,over:tokens>limit};
}
export async function parseMaterial(name,base64) {
  if(typeof name!=='string'||!name.trim()||name.length>160||/[\\/\x00-\x1f]/.test(name))throw new AppError('유효한 파일 이름이 필요합니다.');
  const extension=extname(name).toLowerCase();
  if(!['.pdf','.txt','.md','.csv'].includes(extension))throw new AppError('PDF, TXT, MD, CSV 파일만 추가할 수 있습니다.');
  if(typeof base64!=='string'||base64.length>Math.ceil(MAX_FILE_BYTES/3)*4||base64.length%4!==0||!/^[A-Za-z0-9+/]*={0,2}$/.test(base64))throw new AppError('파일은 최대 10MB입니다. 올바른 파일을 선택하세요.',413);
  const bytes=Buffer.from(base64,'base64');
  if(!bytes.length||bytes.length>MAX_FILE_BYTES)throw new AppError('빈 파일 또는 10MB를 초과한 파일입니다.',413);
  let parsed;
  if(extension==='.pdf') {
    if(!bytes.subarray(0,1024).includes(Buffer.from('%PDF-')))throw new AppError('올바른 PDF 파일이 아닙니다.');
    parsed=await new Promise((resolve,reject)=>{
      const worker=new Worker(new URL('./pdf-worker.mjs',import.meta.url),{workerData:bytes,resourceLimits:{maxOldGenerationSizeMb:256}});
      const timer=setTimeout(()=>{worker.terminate();reject(new AppError('PDF 분석 시간이 초과되었습니다. 더 작은 파일을 사용하세요.',413));},30000);
      worker.once('message',result=>{clearTimeout(timer);worker.terminate();result.error?reject(new AppError(result.error)):resolve(result);});
      worker.once('error',()=>{clearTimeout(timer);reject(new AppError('PDF를 분석할 수 없습니다. 암호화·손상 여부를 확인하세요.'));});
      worker.once('exit',code=>{clearTimeout(timer);if(code!==0)reject(new AppError('PDF 분석이 중단되었습니다.'));});
    });
  } else {
    try{parsed={text:new TextDecoder('utf-8',{fatal:true}).decode(bytes),pages:null,warnings:[]};}
    catch{throw new AppError('텍스트 파일은 UTF-8로 저장한 뒤 추가하세요.');}
  }
  if(parsed.text.length>300000)throw new AppError('추출 텍스트는 파일당 300,000자까지 지원합니다.',413);
  if(!parsed.text.trim())throw new AppError('읽을 수 있는 텍스트가 없습니다. 스캔 PDF는 OCR 처리 후 추가하세요.');
  const file={name:name.trim(),...parsed,kind:extension.slice(1),size:bytes.length};
  file.tokens=materialTokens(file);
  return {file,bytes};
}
