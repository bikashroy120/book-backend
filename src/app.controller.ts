import { Controller, Get } from '@nestjs/common';
import { Public } from './common/decorators/public.decorator';

@Controller()
export class AppController {
  @Public()
  @Get('health')
  getHealth(): { status: 'ok'; time: string } {
    return { status: 'ok', time: new Date().toISOString() };
  }
}
