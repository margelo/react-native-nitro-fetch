import 'web-streams-polyfill/polyfill';
import { TextDecoder } from './TextDecoder';

export { TextDecoder };
export { fetch } from './fetch';
export type { FetchOptions, FetchResponse } from './fetch';
export type {
  NetworkExceptionErrorCode,
  CronetException,
  NetworkException,
  QuicException,
  CallbackException,
  InlineExecutionProhibitedException,
} from './NitroCronetException.nitro';
