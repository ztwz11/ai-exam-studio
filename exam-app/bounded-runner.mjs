import {AppError} from './errors.mjs';
import {measureInput,limitAnswer} from './tokens.mjs';
import {runCodex} from './codex.mjs';

// Exam requests and the test harness use this same enforcement path.
export async function executeContext(context, {runner=runCodex, signal, timeoutMs=180000}={}) {
  signal?.throwIfAborted();
  const measured=measureInput(context.input,context.instructions);
  const value=context.unit==='characters'?Array.from(`${context.instructions}\n\n${context.input}`).length:measured.tokens;
  if(value>context.limit) throw new AppError('문맥 한도 초과: CLI 실행 전에 요청을 차단했습니다.',413);
  const started=performance.now();
  const response=await runner(context.input,{instructions:context.instructions,model:context.model,reasoningEffort:context.reasoningEffort,signal,timeoutMs});
  signal?.throwIfAborted();
  const limited=limitAnswer(response.text,context.outputTokenLimit);
  return {...limited,usage:response.usage??null,inputTokens:measured.tokens,elapsedMs:Math.round(performance.now()-started)};
}
