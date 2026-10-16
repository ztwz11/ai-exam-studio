import {getEncoding} from 'js-tiktoken';
import {AppError} from './errors.mjs';

export const TOKENIZER = 'o200k_base';
export const DEFAULT_INPUT_TOKENS = 4096;
export const DEFAULT_OUTPUT_TOKENS = 1024;
const encoding = getEncoding(TOKENIZER);
// Treat special-token-looking strings in documents as ordinary text.
const encode = text => encoding.encode(text, [], []);
export const countTokens = text => encode(text).length;
export function tokenLimits(config = {}) {
  const inputTokenLimit = Number(config.inputTokenLimit ?? DEFAULT_INPUT_TOKENS);
  const outputTokenLimit = Number(config.outputTokenLimit ?? DEFAULT_OUTPUT_TOKENS);
  if (!Number.isInteger(inputTokenLimit) || inputTokenLimit < 128 || inputTokenLimit > 32768) throw new AppError('입력 토큰 한도는 128~32,768 사이의 정수여야 합니다.');
  if (!Number.isInteger(outputTokenLimit) || outputTokenLimit < 32 || outputTokenLimit > 8192) throw new AppError('답변 토큰 한도는 32~8,192 사이의 정수여야 합니다.');
  return {inputTokenLimit, outputTokenLimit};
}
export function measureInput(input, instructions) {
  const inputTextTokens = countTokens(input), instructionTokens = countTokens(instructions);
  return {tokens:inputTextTokens + instructionTokens, inputTextTokens, instructionTokens, tokenizer:TOKENIZER};
}
export function limitAnswer(text, limit = DEFAULT_OUTPUT_TOKENS) {
  if(typeof text !== 'string') throw new AppError('AI가 유효한 텍스트 답변을 반환하지 않았습니다.',502);
  if(!Number.isInteger(limit) || limit<1) throw new AppError('잘못된 답변 토큰 한도입니다.');
  const encoded = encode(text), originalTokens = encoded.length;
  let answer = text;
  if(originalTokens > limit) {
    // Back off partial UTF-8 characters (Korean/emoji) rather than emitting U+FFFD.
    let end = limit;
    do { answer = encoding.decode(encoded.slice(0,end--)); }
    while(end >= 0 && (!text.startsWith(answer) || countTokens(answer)>limit));
  }
  return {text:answer, output:{tokenizer:TOKENIZER, limit, originalTokens, deliveredTokens:countTokens(answer), truncated:answer!==text, enforcement:'delivered-text-only'}};
}
