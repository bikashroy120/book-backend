import { CallHandler, ExecutionContext, StreamableFile } from '@nestjs/common';
import { firstValueFrom, of } from 'rxjs';
import { TransformInterceptor } from './transform.interceptor';

describe('TransformInterceptor raw responses', () => {
  const interceptor = new TransformInterceptor();
  const context = {} as ExecutionContext;

  it.each([new StreamableFile(Buffer.from('csv')), Buffer.from('csv'), 'csv'])(
    'passes raw responses through unchanged',
    async (rawResponse) => {
      const handler: CallHandler = {
        handle: () => of(rawResponse),
      };

      await expect(
        firstValueFrom(interceptor.intercept(context, handler)),
      ).resolves.toBe(rawResponse);
    },
  );
});
