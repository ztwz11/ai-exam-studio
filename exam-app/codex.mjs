import {spawn} from 'node:child_process';
import {existsSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve as resolvePath,sep} from 'node:path';
import {instructionsFor, AppError} from './core.mjs';

export function findCodex() {
  if (process.env.CODEX_EXAM_BIN && existsSync(process.env.CODEX_EXAM_BIN)) return {command:process.env.CODEX_EXAM_BIN, prefix:[]};
  if (process.platform === 'win32') {
    const base = join(process.env.APPDATA || '', 'npm', 'node_modules', '@openai', 'codex');
    const native = join(base,'node_modules','@openai','codex-win32-x64','vendor','x86_64-pc-windows-msvc','bin','codex.exe');
    if(existsSync(native)) return {command:native,prefix:[]};
    const script=join(base,'bin','codex.js');
    if(existsSync(script)) return {command:process.execPath,prefix:[script]};
  }
  return {command:'codex',prefix:[]};
}
export function makeArgs(directory, {instructions=instructionsFor(),model=process.env.CODEX_EXAM_MODEL,reasoningEffort,outputSchemaPath}={}) {
  const configs = {
    approval_policy:'never', web_search:'disabled', project_doc_max_bytes:0,
    developer_instructions:instructions,
    'features.shell_tool':false, 'features.unified_exec':false,
    'features.apps':false, 'features.plugins':false, 'features.remote_plugin':false,
    'features.browser_use':false, 'features.computer_use':false, 'features.in_app_browser':false,
    'features.multi_agent':false, 'features.multi_agent_v2':false,
    'features.memories':false, 'features.hooks':false, 'features.skill_search':false,
    'features.skip_host_skill_discovery':true, 'features.image_generation':false,
    'features.view_image':false, 'features.sleep_tool':false,
    'features.code_mode':false, 'features.code_mode_host':false,
    'history.persistence':'none'
  };
  if(reasoningEffort)configs.model_reasoning_effort=reasoningEffort;
  const args=['exec','--ignore-user-config','--ephemeral','--skip-git-repo-check','--sandbox','read-only','--json','--color','never','--cd',directory];
  for(const [key,value] of Object.entries(configs)) args.push('-c',`${key}=${JSON.stringify(value)}`);
  if(model) args.push('--model',model);
  if(outputSchemaPath)args.push('--output-schema',outputSchemaPath);
  args.push('-');
  return args;
}
export function runCodex(input, {signal, onEvent=()=>{}, instructions=instructionsFor(), model, reasoningEffort, outputSchema, timeoutMs=180000, spawnProcess=spawn}={}) {
  if(signal?.aborted)return Promise.reject(new AppError('요청이 취소되었습니다.',409));
  return new Promise((resolve,reject)=>{
    const directory=mkdtempSync(join(tmpdir(),'ai-exam-'));
    const outputSchemaPath=outputSchema?join(directory,'output-schema.json'):undefined;
    if(outputSchemaPath)writeFileSync(outputSchemaPath,JSON.stringify(outputSchema));
    const runner=findCodex();
    const child=spawnProcess(runner.command,[...runner.prefix,...makeArgs(directory,{instructions,model,reasoningEffort,outputSchemaPath})],{stdio:['pipe','pipe','pipe'],windowsHide:true,shell:false});
    let buffer='', stderr='', final='', usage=null, failure=null, settled=false;
    const cleanup=()=>{clearTimeout(timeout);signal?.removeEventListener('abort',abort);const target=resolvePath(directory);try{if(target.startsWith(resolvePath(tmpdir())+sep+'ai-exam-'))rmSync(target,{recursive:true,force:true});}catch{}};
    const finish=(error)=>{if(settled)return;settled=true;cleanup();error?reject(error):resolve({text:final,usage});};
    const stop=(message)=>{failure=message;child.kill();};
    const abort=()=>stop('요청이 취소되었습니다.');
    const timeout=setTimeout(()=>stop(`AI 응답 시간이 ${Math.ceil(timeoutMs/1000)}초를 초과했습니다. 잠시 후 다시 시도하세요.`),timeoutMs);
    signal?.addEventListener('abort',abort,{once:true});
    if(signal?.aborted) abort();
    child.on('error',()=>finish(new AppError('Codex CLI를 실행할 수 없습니다. 설치 경로나 CODEX_EXAM_BIN을 확인하세요.',503)));
    child.stderr.on('data',chunk=>{stderr=(stderr+chunk.toString()).slice(-12000);});
    const consume=line=>{
      let event;try{event=JSON.parse(line);}catch{return;}
      if(event.type==='item.started' || event.type==='item.completed') {
        const item=event.item;
        if(['command_execution','mcp_tool_call','web_search','file_change'].includes(item?.type)) {stop('시험 모드에서 허용하지 않는 도구 사용이 감지되어 응답을 중단했습니다.');return;}
        if(event.type==='item.completed' && item?.type==='agent_message') final=item.text || final;
      }
      if(event.type==='turn.completed') usage=event.usage??null;
      if(event.type==='turn.failed') failure=event.error?.message || 'AI 처리에 실패했습니다.';
      if(event.type==='error')failure=event.message || 'Codex 모델 호출에 실패했습니다.';
      onEvent(event.type);
    };
    child.stdout.setEncoding('utf8');
    child.stdout.on('data',chunk=>{buffer+=chunk;if(buffer.length>2_000_000){stop('응답 크기 제한을 초과했습니다.');return;}let i;while((i=buffer.indexOf('\n'))>=0){consume(buffer.slice(0,i));buffer=buffer.slice(i+1);}});
    child.stdin.on('error',()=>{});
    child.stdin.end(input);
    child.on('close',code=>{
      if(buffer.trim())consume(buffer);
      if(failure || code!==0 || !final) {
        const detail = /401|unauthorized|not logged|authentication/i.test(stderr) ? 'Codex 로그인이 필요합니다. 터미널에서 codex login을 실행하세요.' : /quota|usage limit|rate limit/i.test(stderr) ? 'Codex 사용 한도에 도달했습니다. 계정의 한도를 확인하세요.' : /access.*denied|permission|액세스가 거부/i.test(stderr) ? 'Codex 실행 권한이 부족합니다. 로컬 PowerShell에서 실행 스크립트를 시작하세요.' : 'Codex 응답을 받지 못했습니다. 로그인, 네트워크, CLI 버전을 확인하세요.';
        finish(new AppError(failure || detail,502));
      } else finish();
    });
  });
}
