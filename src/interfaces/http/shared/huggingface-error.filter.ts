import { ArgumentsHost, Catch, ExceptionFilter } from '@nestjs/common';
import type { Response } from 'express';
import {
  HuggingFaceConnectionError,
  HuggingFaceTimeoutError,
  HuggingFaceUpstreamError,
} from '../../../domain/huggingface/huggingface-errors';

type CaughtError =
  | HuggingFaceConnectionError
  | HuggingFaceTimeoutError
  | HuggingFaceUpstreamError;

/**
 * 502: o pedido do cliente está bem formado, quem falhou foi o Hugging Face
 * Hub (ou a rede até ele) — nunca 500, que diria que o defeito é nosso.
 */
@Catch(
  HuggingFaceConnectionError,
  HuggingFaceTimeoutError,
  HuggingFaceUpstreamError,
)
export class HuggingFaceErrorFilter implements ExceptionFilter {
  catch(exception: CaughtError, host: ArgumentsHost) {
    const response = host.switchToHttp().getResponse<Response>();
    response.status(502).json({
      statusCode: 502,
      message: exception.message,
      error: 'Bad Gateway',
    });
  }
}
