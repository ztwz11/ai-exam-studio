import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import {runCodex} from '../codex.mjs';
function fakeSpawn(events,{hang=false,record}={}){
  return (command,args,options)=>{
    record?.({command,args,options});const child=new EventEmitter();child.stdin=new PassThrough();child.stdout=new PassThrough();child.stderr=new PassThrough();let closed=false;
    const close=code=>{if(!closed){closed=true;child.emit('close',code);}};child.kill=()=>{setImmediate(()=>close(1));return true;};
    child.stdin.on('finish',()=>setImmediate(()=>{if(hang)return;const data=events.map(e=>JSON.stringify(e)).join('\n');const bytes=Buffer.from(data);for(let i=0;i<bytes.length;i+=7)child.stdout.write(bytes.subarray(i,i+7));child.stdout.end();setImmediate(()=>close(0));}));
    return child;
  };
}
test('CLI parser handles fragmented JSON/UTF-8 and returns final text and actual usage',async()=>{
  const usage={input_tokens:900,output_tokens:12};let spawnOptions;
  const result=await runCodex('자료',{spawnProcess:fakeSpawn([{type:'item.completed',item:{type:'agent_message',text:'한글🙂 답변'}},{type:'turn.completed',usage}],{record:r=>spawnOptions=r.options})});
  assert.equal(result.text,'한글🙂 답변');assert.deepEqual(result.usage,usage);assert.equal(spawnOptions.shell,false);assert.equal(spawnOptions.windowsHide,true);
});
test('CLI stops a disallowed tool event even if final text follows',async()=>{
  await assert.rejects(runCodex('자료',{spawnProcess:fakeSpawn([{type:'item.started',item:{type:'command_execution'}},{type:'item.completed',item:{type:'agent_message',text:'답'}}])}),/허용하지 않는 도구/);
});
test('CLI timeout and cancellation terminate the process',async()=>{
  await assert.rejects(runCodex('자료',{spawnProcess:fakeSpawn([],{hang:true}),timeoutMs:20}),/초과/);
  const controller=new AbortController();controller.abort();let spawned=false;
  await assert.rejects(runCodex('자료',{signal:controller.signal,spawnProcess:()=>{spawned=true;}}),/취소/);assert.equal(spawned,false);
});
test('CLI model errors are returned instead of being hidden by a generic message',async()=>{
  await assert.rejects(runCodex('자료',{spawnProcess:fakeSpawn([{type:'error',message:'Requested model is not available'}])}),/Requested model is not available/);
});
