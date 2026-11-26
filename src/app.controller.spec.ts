import { Test, TestingModule } from '@nestjs/testing';
import { AppController } from './app.controller';

describe('AppController', () => {
  let appController: AppController;

  beforeEach(async () => {
    const app: TestingModule = await Test.createTestingModule({
      controllers: [AppController],
    }).compile();

    appController = app.get<AppController>(AppController);
  });

  describe('health', () => {
    it('returns an ok status and an ISO timestamp', () => {
      const result = appController.getHealth();
      expect(result.status).toBe('ok');
      expect(Number.isNaN(Date.parse(result.time))).toBe(false);
    });
  });
});
