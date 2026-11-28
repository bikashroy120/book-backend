import { plainToInstance, Type } from 'class-transformer';
import {
  IsInt,
  Matches,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUrl,
  Max,
  Min,
  validateSync,
} from 'class-validator';

class EnvironmentVariables {
  @IsString()
  @IsNotEmpty()
  DATABASE_URL!: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  PORT = 3000;

  @Type(() => Number)
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  DATABASE_POOL_MAX?: number;

  @IsUrl({
    protocols: ['http', 'https'],
    require_protocol: true,
    require_tld: false,
  })
  FRONTEND_URL!: string;

  @IsString()
  @IsNotEmpty()
  ACCESS_TOKEN_SECRET!: string;

  @IsString()
  @IsNotEmpty()
  @Matches(/^[1-9]\d*[smhd]$/)
  ACCESS_TOKEN_EXPIRES = '15m';

  @IsString()
  @IsNotEmpty()
  REFRESH_TOKEN_SECRET!: string;

  @IsString()
  @IsNotEmpty()
  @Matches(/^[1-9]\d*[smhd]$/)
  REFRESH_TOKEN_EXPIRES = '7d';

  @IsString()
  @IsNotEmpty()
  UPLOAD_DIR = './uploads';

  @IsString()
  @IsNotEmpty()
  MAIL_FROM!: string;

  @IsString()
  @IsNotEmpty()
  CLOUDINARY_CLOUD_NAME!: string;

  @IsString()
  @IsNotEmpty()
  CLOUDINARY_API_KEY!: string;

  @IsString()
  @IsNotEmpty()
  CLOUDINARY_API_SECRET!: string;

  @IsOptional()
  @IsString()
  @Matches(/^.{32,}$/)
  CRON_SECRET?: string;
}

export function validate(config: Record<string, unknown>) {
  const validatedConfig = plainToInstance(EnvironmentVariables, config, {
    enableImplicitConversion: true,
  });
  const errors = validateSync(validatedConfig, {
    skipMissingProperties: false,
  });

  if (errors.length > 0) {
    const invalidFields = errors.map((error) => error.property).join(', ');
    throw new Error(`Invalid environment configuration: ${invalidFields}`);
  }

  if (process.env.VERCEL && !validatedConfig.CRON_SECRET) {
    throw new Error('CRON_SECRET is required when running on Vercel');
  }

  return validatedConfig;
}
