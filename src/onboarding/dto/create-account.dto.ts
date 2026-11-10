import { IsEmail, IsString, Matches, MinLength } from 'class-validator';

/** Login details collected on the first signup step. Email confirmation is off for now. */
export class CreateAccountDto {
  @IsString()
  @MinLength(1)
  full_name!: string;

  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(6)
  password!: string;

  @Matches(/^\+971\d{8,9}$/)
  phone!: string;
}
