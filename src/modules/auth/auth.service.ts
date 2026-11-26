import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { TokenType, UserRole, UserStatus } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../../core/database/prisma.service';
import { MailService } from '../../core/mail/mail.service';
import { randomToken, sha256 } from '../../common/utils/crypto';
import type { JwtPayload } from '../../common/types/auth-user';
import type { RegisterDTO } from './dto/register.dto';
import type { LoginDTO } from './dto/login.dto';
import type { RefreshDTO } from './dto/refresh.dto';
import type { VerifyEmailDTO } from './dto/verify-email.dto';
import type { ForgotPasswordDTO } from './dto/forgot-password.dto';
import type { ResetPasswordDTO } from './dto/reset-password.dto';

const invalidCredentialsMessage = 'Invalid email/phone or password';
const genericForgotPasswordMessage =
  'If an account exists for this email, password reset instructions will be sent.';
const publicUserSelect = {
  id: true,
  name: true,
  email: true,
  role: true,
  avatarUrl: true,
  language: true,
} as const;
const registrationUserSelect = {
  ...publicUserSelect,
  phone: true,
} as const;

type PublicUser = {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  avatarUrl: string | null;
  language: string;
};
type RegistrationUser = PublicUser & { phone: string | null };

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly mail: MailService,
  ) {}

  async register(input: RegisterDTO): Promise<RegistrationUser> {
    const password = await bcrypt.hash(input.password, 12);
    const rawToken = randomToken();
    const token = sha256(rawToken);
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

    const user = await this.prisma.$transaction(async (transaction) => {
      const createdUser = await transaction.user.create({
        data: {
          name: input.name,
          email: input.email,
          ...(input.phone ? { phone: input.phone } : {}),
          password,
          role: UserRole.USER,
          ...(input.language ? { language: input.language } : {}),
        },
        select: registrationUserSelect,
      });

      await transaction.verificationToken.create({
        data: {
          token,
          type: TokenType.VERIFY_EMAIL,
          userId: createdUser.id,
          expiresAt,
        },
      });

      return createdUser;
    });

    const verificationUrl = new URL(
      '/verify-email',
      this.config.getOrThrow<string>('FRONTEND_URL'),
    );
    verificationUrl.searchParams.set('token', rawToken);

    await this.mail.sendMail({
      to: user.email,
      subject: 'Verify your Hosonta Prokashon account',
      html: `<p>Verify your email address: <a href="${verificationUrl.toString()}">Verify email</a></p>`,
    });

    return user;
  }

  async login(input: LoginDTO) {
    const isPhone = /^01[3-9]\d{8}$/.test(input.identifier);
    const user = await this.prisma.user.findUnique({
      where: isPhone
        ? { phone: input.identifier }
        : { email: input.identifier },
      select: {
        ...publicUserSelect,
        password: true,
        status: true,
      },
    });

    const passwordMatches = user
      ? await bcrypt.compare(input.password, user.password)
      : false;
    if (!user || !passwordMatches) {
      throw new UnauthorizedException(invalidCredentialsMessage);
    }

    if (user.status === UserStatus.SUSPENDED) {
      throw new ForbiddenException('This account is suspended');
    }

    await this.prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });

    const tokens = await this.createTokenPair(user);
    return {
      ...tokens,
      user: this.toPublicUser(user),
    };
  }

  async refresh(input: RefreshDTO): Promise<{ accessToken: string }> {
    let payload: JwtPayload;
    try {
      payload = await this.jwt.verifyAsync<JwtPayload>(input.refreshToken, {
        secret: this.config.getOrThrow<string>('REFRESH_TOKEN_SECRET'),
      });
    } catch {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }

    if (
      !payload ||
      typeof payload.sub !== 'string' ||
      typeof payload.email !== 'string' ||
      !Object.values(UserRole).includes(payload.role)
    ) {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }

    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      select: {
        id: true,
        email: true,
        role: true,
        status: true,
      },
    });

    if (!user) {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }
    if (user.status === UserStatus.SUSPENDED) {
      throw new ForbiddenException('This account is suspended');
    }

    return {
      accessToken: await this.signAccessToken({
        sub: user.id,
        email: user.email,
        role: user.role,
      }),
    };
  }

  async verifyEmail(
    input: VerifyEmailDTO,
  ): Promise<{ data: null; message: string }> {
    const token = await this.prisma.verificationToken.findUnique({
      where: { token: sha256(input.token) },
      select: { id: true, type: true, expiresAt: true },
    });

    if (
      !token ||
      token.type !== TokenType.VERIFY_EMAIL ||
      token.expiresAt <= new Date()
    ) {
      throw new BadRequestException('Verification token is invalid or expired');
    }

    await this.prisma.verificationToken.delete({ where: { id: token.id } });
    return { data: null, message: 'Email verified successfully' };
  }

  async forgotPassword(
    input: ForgotPasswordDTO,
  ): Promise<{ data: null; message: string }> {
    const user = await this.prisma.user.findUnique({
      where: { email: input.email },
      select: { id: true, email: true },
    });

    if (user) {
      const rawToken = randomToken();
      await this.prisma.verificationToken.create({
        data: {
          token: sha256(rawToken),
          type: TokenType.RESET_PASSWORD,
          userId: user.id,
          expiresAt: new Date(Date.now() + 60 * 60 * 1000),
        },
      });

      const resetUrl = new URL(
        '/reset-password',
        this.config.getOrThrow<string>('FRONTEND_URL'),
      );
      resetUrl.searchParams.set('token', rawToken);
      await this.mail.sendMail({
        to: user.email,
        subject: 'Reset your Hosonta Prokashon password',
        html: `<p>Reset your password: <a href="${resetUrl.toString()}">Reset password</a></p>`,
      });
    }

    return { data: null, message: genericForgotPasswordMessage };
  }

  async resetPassword(
    input: ResetPasswordDTO,
  ): Promise<{ data: null; message: string }> {
    const token = await this.prisma.verificationToken.findUnique({
      where: { token: sha256(input.token) },
      select: { id: true, userId: true, type: true, expiresAt: true },
    });

    if (
      !token ||
      token.type !== TokenType.RESET_PASSWORD ||
      token.expiresAt <= new Date()
    ) {
      throw new BadRequestException('Reset token is invalid or expired');
    }

    const password = await bcrypt.hash(input.newPassword, 12);
    await this.prisma.$transaction(async (transaction) => {
      await transaction.user.update({
        where: { id: token.userId },
        data: { password },
      });
      await transaction.verificationToken.deleteMany({
        where: { userId: token.userId, type: TokenType.RESET_PASSWORD },
      });
    });

    return { data: null, message: 'Password reset successfully' };
  }

  private async createTokenPair(user: PublicUser) {
    const payload: JwtPayload = {
      sub: user.id,
      email: user.email,
      role: user.role,
    };
    const [accessToken, refreshToken] = await Promise.all([
      this.jwt.signAsync(payload, {
        secret: this.config.getOrThrow<string>('ACCESS_TOKEN_SECRET'),
        expiresIn: this.expirationInSeconds(
          this.config.getOrThrow<string>('ACCESS_TOKEN_EXPIRES'),
        ),
      }),
      this.jwt.signAsync(payload, {
        secret: this.config.getOrThrow<string>('REFRESH_TOKEN_SECRET'),
        expiresIn: this.expirationInSeconds(
          this.config.getOrThrow<string>('REFRESH_TOKEN_EXPIRES'),
        ),
      }),
    ]);

    return { accessToken, refreshToken };
  }

  private async signAccessToken(payload: JwtPayload): Promise<string> {
    return this.jwt.signAsync(payload, {
      secret: this.config.getOrThrow<string>('ACCESS_TOKEN_SECRET'),
      expiresIn: this.expirationInSeconds(
        this.config.getOrThrow<string>('ACCESS_TOKEN_EXPIRES'),
      ),
    });
  }

  private expirationInSeconds(duration: string): number {
    const match = /^([1-9]\d*)([smhd])$/.exec(duration);
    if (!match) {
      throw new Error('Invalid JWT expiration configuration');
    }

    const amount = Number(match[1]);
    const multiplier = { s: 1, m: 60, h: 3600, d: 86400 }[match[2]];
    if (multiplier === undefined) {
      throw new Error('Invalid JWT expiration configuration');
    }
    return amount * multiplier;
  }

  private toPublicUser(user: PublicUser): PublicUser {
    return {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      avatarUrl: user.avatarUrl,
      language: user.language,
    };
  }
}
