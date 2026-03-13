import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  Logger,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap, catchError } from 'rxjs/operators';
import { trace } from '@opentelemetry/api';

@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger('HTTP');

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = context.switchToHttp().getRequest();
    const { method, url, ip } = req;
    const userAgent = req.get('user-agent') ?? '';
    const startTime = Date.now();

    const span = trace.getActiveSpan();
    const traceId = span?.spanContext().traceId ?? '-';

    return next.handle().pipe(
      tap(() => {
        const res = context.switchToHttp().getResponse();
        const delay = Date.now() - startTime;
        this.logger.log(
          `${method} ${url} ${res.statusCode} ${delay}ms — ${ip} "${userAgent}" [${traceId}]`,
        );
      }),
      catchError((err) => {
        const delay = Date.now() - startTime;
        this.logger.error(
          `${method} ${url} ERROR ${delay}ms — ${ip} [${traceId}]`,
          err?.stack,
        );
        throw err;
      }),
    );
  }
}
