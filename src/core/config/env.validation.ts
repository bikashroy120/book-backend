import { plainToInstance, Type } from 'class-transformer';
import {
  IsInt,
  IsNotEmpty,
  IsString,
  IsUrl,
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
  ACCESS_TOKEN_EXPIRES = '15m';

  @IsString()
  @IsNotEmpty()
  REFRESH_TOKEN_SECRET!: string;

  @IsString()
  @IsNotEmpty()
  REFRESH_TOKEN_EXPIRES = '7d';

  @IsString()
  @IsNotEmpty()
  UPLOAD_DIR = './uploads';

  @IsString()
  @IsNotEmpty()
  MAIL_FROM!: string;
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

  return validatedConfig;
}
