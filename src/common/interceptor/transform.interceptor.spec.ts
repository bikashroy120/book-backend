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

  it('omits password and token hashes from JSON response data', async () => {
    const handler: CallHandler = {
      handle: () =>
        of({
          id: 'user-1',
          password: 'password-hash',
          nested: {
            token: 'verification-token-hash',
            tokenHash: 'another-token-hash',
            accessToken: 'signed-access-token',
          },
        }),
    };
    const contextWithStatus = {
      switchToHttp: () => ({ getResponse: () => ({ statusCode: 200 }) }),
    } as ExecutionContext;

    await expect(
      firstValueFrom(interceptor.intercept(contextWithStatus, handler)),
    ).resolves.toEqual({
      success: true,
      statusCode: 200,
      message: 'Success',
      data: {
        id: 'user-1',
        nested: { accessToken: 'signed-access-token' },
      },
    });
  });
});
