import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { trace, SpanStatusCode } from '@opentelemetry/api';

interface ErrorResponse {
  statusCode: number;
  timestamp: string;
  path: string;
  method: string;
  message: string | string[];
  traceId?: string;
}

@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(GlobalExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const status =
      exception instanceof HttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;

    const message =
      exception instanceof HttpException
        ? exception.getResponse()
        : 'Internal server error';

    // Get current trace ID for correlation
    const span = trace.getActiveSpan();
    const traceId = span?.spanContext().traceId;

    // Mark span as errored in OpenTelemetry
    if (span) {
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: String(exception instanceof Error ? exception.message : message),
      });
    }

    const errorResponse: ErrorResponse = {
      statusCode: status,
      timestamp: new Date().toISOString(),
      path: request.url,
      method: request.method,
      message:
        typeof message === 'object' && 'message' in message
          ? (message as any).message
          : String(message),
      traceId,
    };

    // Log 5xx errors as errors, 4xx as warnings
    if (status >= 500) {
      this.logger.error(
        `${request.method} ${request.url} → ${status}`,
        exception instanceof Error ? exception.stack : String(exception),
        { traceId },
      );
    } else {
      this.logger.warn(`${request.method} ${request.url} → ${status}`, {
        message: errorResponse.message,
        traceId,
      });
    }

    response.status(status).json(errorResponse);
  }
}
