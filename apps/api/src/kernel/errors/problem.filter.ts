import type { ErrorCode, ProblemDetails } from '@arabat/contracts';
import { type ArgumentsHost, Catch, type ExceptionFilter, HttpException } from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { AppError } from './app-error.js';

const STATUS_CODES: Record<number, ErrorCode> = {
  400: 'MALFORMED_REQUEST',
  401: 'UNAUTHENTICATED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  405: 'METHOD_NOT_ALLOWED',
  409: 'CONFLICT',
  413: 'PAYLOAD_TOO_LARGE',
  415: 'MALFORMED_REQUEST',
  429: 'RATE_LIMITED',
  503: 'SERVICE_UNAVAILABLE',
};

const TITLES: Partial<Record<ErrorCode, string>> = {
  VALIDATION_FAILED: 'Validation failed',
  MALFORMED_REQUEST: 'Malformed request',
  UNAUTHENTICATED: 'Authentication required',
  FORBIDDEN: 'Forbidden',
  NOT_FOUND: 'Not found',
  ROUTE_NOT_FOUND: 'Route not found',
  METHOD_NOT_ALLOWED: 'Method not allowed',
  CONFLICT: 'Conflict',
  PAYLOAD_TOO_LARGE: 'Payload too large',
  RATE_LIMITED: 'Too many requests',
  SERVICE_UNAVAILABLE: 'Service unavailable',
  INTERNAL_ERROR: 'Internal server error',
};

interface FastifyLikeError {
  statusCode?: number;
  code?: string;
  message?: string;
}

/** Converts every error into an RFC 9457 `application/problem+json` response. */
@Catch()
export class ProblemDetailsFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const request = http.getRequest<FastifyRequest>();
    const reply = http.getResponse<FastifyReply>();
    const problem = this.toProblem(exception, request);

    if (problem.status >= 500) {
      request.log.error({ err: exception }, 'Unhandled error');
    } else {
      request.log.info({ code: problem.code, status: problem.status }, 'Request rejected');
    }

    void reply
      .status(problem.status)
      .header('content-type', 'application/problem+json')
      .send(problem);
  }

  private toProblem(exception: unknown, request: FastifyRequest): ProblemDetails {
    const base = { instance: request.url, requestId: String(request.id) };

    if (exception instanceof AppError) {
      return {
        type: `urn:arabat:error:${exception.code.toLowerCase()}`,
        title: TITLES[exception.code] ?? exception.code,
        status: exception.status,
        code: exception.code,
        detail: exception.message,
        ...(exception.issues ? { issues: exception.issues } : {}),
        ...base,
      };
    }

    let status = 500;
    let detail: string | undefined;
    if (exception instanceof HttpException) {
      status = exception.getStatus();
      detail = exception.message;
    } else if (isFastifyError(exception)) {
      // Errors raised by Fastify itself (invalid JSON body, body too large, ...).
      status = exception.statusCode;
      detail = exception.message;
    }

    let code: ErrorCode =
      status >= 500 ? 'INTERNAL_ERROR' : (STATUS_CODES[status] ?? 'MALFORMED_REQUEST');
    if (status === 404 && exception instanceof HttpException) code = 'ROUTE_NOT_FOUND';
    if (status === 503) code = 'SERVICE_UNAVAILABLE';

    return {
      type: `urn:arabat:error:${code.toLowerCase()}`,
      title: TITLES[code] ?? code,
      status,
      code,
      // Never leak internal error messages or stack traces.
      ...(status < 500 && detail ? { detail } : {}),
      ...base,
    };
  }
}

function isFastifyError(value: unknown): value is FastifyLikeError & { statusCode: number } {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as FastifyLikeError).statusCode === 'number' &&
    (value as FastifyLikeError).statusCode! >= 400 &&
    (value as FastifyLikeError).statusCode! < 600
  );
}
