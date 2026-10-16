import {parentPort,workerData} from 'node:worker_threads';
import {getDocument} from 'pdfjs-dist/legacy/build/pdf.mjs';
import {fileURLToPath} from 'node:url';
let task;
try {
  const assets=new URL('./node_modules/pdfjs-dist/',import.meta.url);
  task=getDocument({data:new Uint8Array(workerData),isEvalSupported:false,useSystemFonts:false,disableFontFace:true,verbosity:0,cMapUrl:fileURLToPath(new URL('cmaps/',assets)).replaceAll('\\','/'),cMapPacked:true,standardFontDataUrl:fileURLToPath(new URL('standard_fonts/',assets)).replaceAll('\\','/')});
  const doc=await task.promise;
  if(doc.numPages>100)throw new Error('PDF는 최대 100페이지까지 지원합니다.');
  const pages=[];let length=0;const empty=[];
  for(let i=1;i<=doc.numPages;i++) {
    const page=await doc.getPage(i),content=await page.getTextContent();
    const text=content.items.filter(item=>'str'in item).map(item=>item.str+(item.hasEOL?'\n':' ')).join('').trim();
    length+=text.length;if(length>300000)throw new Error('추출 텍스트는 최대 300,000자입니다.');
    if(!text)empty.push(i);
    pages.push({number:i,text});page.cleanup();
  }
  if(empty.length===pages.length)throw new Error('텍스트가 없는 스캔 PDF입니다. OCR 처리 후 추가하세요.');
  parentPort.postMessage({pages,text:pages.map(p=>`[페이지 ${p.number}]\n${p.text||'(추출 가능한 텍스트 없음)'}`).join('\n\n'),warnings:['텍스트만 AI에 전달됩니다. 표의 읽기 순서와 그림·수식은 원본과 대조하세요.',...(empty.length?[`텍스트 없는 페이지: ${empty.join(', ')}. 이 페이지의 시각 정보는 전달되지 않습니다.`]:[])]});
} catch(error) {parentPort.postMessage({error:error.name==='PasswordException'?'암호화된 PDF는 지원하지 않습니다. 암호를 해제한 사본을 사용하세요.':error.message||'PDF 분석 실패'});}
finally{await task?.destroy();}
