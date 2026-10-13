import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
  StreamableFile,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { flattenReportToCsv } from './reports-csv';

/** [feature-spec-1_1_H.md H2-7] ?format=csv → flattened CSV attachment. */
@Injectable()
export class ReportsCsvInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = context.switchToHttp().getRequest<{ query?: { format?: string } }>();
    const res = context.switchToHttp().getResponse<{
      setHeader: (name: string, value: string) => void;
    }>();
    if (req.query?.format !== 'csv') return next.handle();
    return next.handle().pipe(
      map((data) => {
        if (data instanceof StreamableFile) return data;
        const csv = flattenReportToCsv(data);
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', 'attachment; filename="report.csv"');
        return csv;
      }),
    );
  }
}
