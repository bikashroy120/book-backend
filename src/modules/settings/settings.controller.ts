import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Param,
  Put,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { ADMIN_ROLES } from '../../common/constants/roles';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import type { AuthUser } from '../../common/types/auth-user';
import { UpdateSettingDTO } from './dto/update-setting.dto';
import { SettingsService } from './settings.service';

@Controller('settings')
@Roles(...ADMIN_ROLES)
export class SettingsController {
  constructor(private readonly settingsService: SettingsService) {}

  @Public()
  @Get('public')
  getPublic() {
    return this.settingsService.getPublicSettings();
  }

  @Get(':key')
  getOne(@Param('key') key: string, @CurrentUser() user: AuthUser) {
    this.assertSecretAccess(key, user);
    return this.settingsService.getByKey(key);
  }

  @Put(':key')
  upsert(
    @Param('key') key: string,
    @CurrentUser() user: AuthUser,
    @Body() input: UpdateSettingDTO,
  ) {
    this.assertSecretAccess(key, user);
    return this.settingsService.upsert(key, input.value);
  }

  private assertSecretAccess(key: string, user: AuthUser) {
    if (
      /secret|password|token|private.?key|api.?key/i.test(key) &&
      user.role !== UserRole.SUPER_ADMIN
    ) {
      throw new ForbiddenException(
        'Only SUPER_ADMIN can manage secret settings',
      );
    }
  }
}
