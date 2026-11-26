import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Public } from '../../common/decorators/public.decorator';
import { AuthService } from './auth.service';
import { ForgotPasswordDTO } from './dto/forgot-password.dto';
import { LoginDTO } from './dto/login.dto';
import { RefreshDTO } from './dto/refresh.dto';
import { RegisterDTO } from './dto/register.dto';
import { ResetPasswordDTO } from './dto/reset-password.dto';
import { VerifyEmailDTO } from './dto/verify-email.dto';

@Public()
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('register')
  register(@Body() input: RegisterDTO) {
    return this.authService.register(input);
  }

  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('login')
  login(@Body() input: LoginDTO) {
    return this.authService.login(input);
  }

  @Post('refresh')
  refresh(@Body() input: RefreshDTO) {
    return this.authService.refresh(input);
  }

  @Get('verify-email')
  verifyEmail(@Query() input: VerifyEmailDTO) {
    return this.authService.verifyEmail(input);
  }

  @Post('forgot-password')
  forgotPassword(@Body() input: ForgotPasswordDTO) {
    return this.authService.forgotPassword(input);
  }

  @Post('reset-password')
  resetPassword(@Body() input: ResetPasswordDTO) {
    return this.authService.resetPassword(input);
  }
}
