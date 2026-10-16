import test from 'node:test';
import assert from 'node:assert/strict';
import {parseMaterial,materialTokens,attachmentBudget} from '../materials.mjs';
import {buildContext,createSession} from '../core.mjs';
import {pdfFixture} from './pdf-fixture.mjs';
test('PDF extraction preserves page labels and never pretends images were read',async()=>{
  const {file}=await parseMaterial('sample.pdf',pdfFixture().toString('base64'));
  assert.equal(file.pages.length,1);assert.match(file.text,/\[페이지 1\]/);assert.match(file.text,/Hello PDF/);assert.ok(file.tokens>0);assert.ok(file.warnings.length>0);
});
test('uploads reject unsafe names, wrong extensions, malformed files and empty scans',async()=>{
  for(const [name,content] of [['../x.txt','aA=='],['x.exe','aA=='],['x.pdf','aA=='],['x.txt','!!!!'],['x.txt','']])await assert.rejects(parseMaterial(name,content));
  await assert.rejects(parseMaterial('scan.pdf',pdfFixture('').toString('base64')),/스캔/);
});
test('UTF-8 material contents and exact attachment token boundaries are enforced',async()=>{
  const {file}=await parseMaterial('자료.txt',Buffer.from('hello 한글 🙂').toString('base64'));
  assert.equal(file.text,'hello 한글 🙂');assert.equal(file.tokens,materialTokens(file));
  const problem={id:'Q1',markdown:'문제',files:[file]},session=createSession({},[problem]);
  const config={...session.config,attachmentTokenLimit:file.tokens};
  assert.equal(buildContext(problem,session.questions[0],'질문',config).attachmentTokens,file.tokens);
  assert.throws(()=>buildContext(problem,session.questions[0],'질문',{...config,attachmentTokenLimit:file.tokens-1}),/첨부 한도 초과/);
  assert.throws(()=>buildContext(problem,{...session.questions[0],attachments:['missing']},'질문',config),/목록에 없는/);
  assert.throws(()=>attachmentBudget({attachmentTokenLimit:4097,inputTokenLimit:4096}),/전체 입력/);
  assert.equal(attachmentBudget({attachmentTokenLimit:0}),0);
});
