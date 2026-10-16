import {readFileSync,mkdirSync,writeFileSync} from 'node:fs';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {runHarness,reportMarkdown,DEMO_CASES} from './harness.mjs';

const args=process.argv.slice(2),root=dirname(fileURLToPath(import.meta.url));
function option(name,fallback){const i=args.indexOf(name);if(i<0)return fallback;if(!args[i+1]||args[i+1].startsWith('--'))throw new Error(`${name} 값이 필요합니다.`);return args[i+1];}
try{
  const valued=new Set(['--cases','--repeat','--input-tokens','--output-tokens','--out']);
  for(let i=0;i<args.length;i++){if(valued.has(args[i])){option(args[i]);i++;}else if(!['--live','--help'].includes(args[i]))throw new Error(`알 수 없는 옵션: ${args[i]}. --help를 확인하세요.`);}
  if(args.includes('--help')){console.log('node harness-cli.mjs [--live] [--cases cases.json] [--repeat 1..3] [--input-tokens 4096] [--output-tokens 1024] [--out directory]\n기본은 mock: Codex 호출 없음. --live는 계정 사용량을 소모합니다.');process.exit(0);}
  const path=option('--cases',null),cases=path?JSON.parse(readFileSync(resolve(path),'utf8')):DEMO_CASES;
  const controller=new AbortController();process.once('SIGINT',()=>controller.abort());
  let seen=0;
  const report=await runHarness({mode:args.includes('--live')?'live':'mock',cases,repetitions:Number(option('--repeat',1)),inputTokenLimit:Number(option('--input-tokens',4096)),outputTokenLimit:Number(option('--output-tokens',1024))},{signal:controller.signal,onProgress:r=>{if(r.results.length>seen){const e=r.results.at(-1);console.log(`${e.status.toUpperCase()} ${e.caseId} #${e.repeat} (${e.elapsedMs}ms)`);seen=r.results.length;}}});
  const out=resolve(option('--out',join(root,'.local','harness')));mkdirSync(out,{recursive:true});
  const base=join(out,`harness-${report.id}`);writeFileSync(base+'.json',JSON.stringify(report,null,2));writeFileSync(base+'.md',reportMarkdown(report));
  console.log(JSON.stringify(report.summary,null,2));console.log(`JSON: ${base}.json\nMarkdown: ${base}.md`);
  process.exitCode=report.summary.failed||report.status==='cancelled'?1:0;
}catch(error){console.error(error.message);process.exitCode=1;}
