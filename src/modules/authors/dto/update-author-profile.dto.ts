import { IsOptional, IsString, IsUrl, MaxLength } from 'class-validator';

const socialUrlOptions = {
  protocols: ['http', 'https'],
  require_protocol: true,
  require_tld: false,
};

export class UpdateAuthorProfileDTO {
  @IsOptional()
  @IsString()
  @MaxLength(300)
  bio?: string | null;

  @IsOptional()
  @IsUrl(socialUrlOptions)
  facebookUrl?: string | null;

  @IsOptional()
  @IsUrl(socialUrlOptions)
  instagramUrl?: string | null;

  @IsOptional()
  @IsUrl(socialUrlOptions)
  websiteUrl?: string | null;
}
