import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import {
  COMPRIMENTO_MAXIMO,
  COMPRIMENTO_MINIMO,
} from '../../../../domain/auth/password-policy';

/**
 * DTOs do auth, já com metadados OpenAPI (Fase 7b, item 8).
 *
 * Os decorators do @nestjs/swagger entram AGORA, junto com as rotas, e não
 * numa varredura retroativa na 7.3: rota nova nasce documentada, que é a
 * única forma de a referência gerada não virar dívida.
 *
 * O `@MaxLength` na senha não é política de senha (essa mora no domínio) — é
 * proteção: argon2id copia a entrada antes de derivar, então senha de
 * megabytes vira custo de memória por requisição numa rota pública e sem
 * autenticação. A validação roda antes de qualquer acesso ao banco e não
 * depende do e-mail, então não abre canal de enumeração.
 */

export class RegisterDto {
  @ApiProperty({ example: 'fulano@brabo.dev', description: "The account's email." })
  @IsEmail()
  email!: string;

  @ApiProperty({
    example: 'correct horse battery staple',
    minLength: COMPRIMENTO_MINIMO,
    description:
      'Password. Minimum of 12 characters; no requirement for uppercase, digit, or symbol.',
  })
  @IsString()
  @MinLength(COMPRIMENTO_MINIMO)
  @MaxLength(COMPRIMENTO_MAXIMO)
  senha!: string;

  @ApiPropertyOptional({ example: 'Fulano de Tal' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  nome?: string;
}

export class LoginDto {
  @ApiProperty({ example: 'fulano@brabo.dev' })
  @IsEmail()
  email!: string;

  @ApiProperty({ example: 'correct horse battery staple' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(COMPRIMENTO_MAXIMO)
  senha!: string;
}

export class VerifyEmailDto {
  @ApiProperty({ description: 'Single-use token received by email.' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(512)
  token!: string;
}

export class RequestPasswordResetDto {
  @ApiProperty({ example: 'fulano@brabo.dev' })
  @IsEmail()
  email!: string;
}

export class ResetPasswordDto {
  @ApiProperty({ description: 'Single-use token received by email.' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(512)
  token!: string;

  @ApiProperty({
    example: 'another pretty long passphrase',
    minLength: COMPRIMENTO_MINIMO,
  })
  @IsString()
  @MinLength(COMPRIMENTO_MINIMO)
  @MaxLength(COMPRIMENTO_MAXIMO)
  novaSenha!: string;
}

export class SessaoResponseDto {
  @ApiProperty({ description: 'Short-lived EdDSA JWT.' })
  accessToken!: string;

  @ApiProperty({
    example: 900,
    description: 'Seconds until the access token expires.',
  })
  expiresIn!: number;

  @ApiProperty({
    example: 'pt-BR',
    enum: ['pt-BR', 'en'],
    description:
      "The user's language preference (i18n foundation, Wave 6a). It comes " +
      'here — and not in a separate call — so the web app never needs an ' +
      'extra round-trip just to know which language to render the screen in.',
  })
  locale!: string;
}

/**
 * O refresh NÃO aparece aqui de propósito (Fase 7a, item 5).
 *
 * Ele vai num cookie `httpOnly`, que o JavaScript não lê. Devolvê-lo também
 * no corpo anularia a proteção: bastaria um XSS ler a resposta do login para
 * levar a sessão longa. O par do cookie é o `brabo_csrf`, que a web ecoa em
 * `X-CSRF-Token`. Ver `session-cookies.ts`.
 */

export class AceiteResponseDto {
  @ApiProperty({
    example: "If the address is available, we've sent an email.",
    description:
      'Generic message, identical for a known and an unknown address — see the enumeration note in the reference.',
  })
  message!: string;
}

export class JwksResponseDto {
  @ApiProperty({
    description: 'Active public Ed25519 keys. Two during a rotation.',
    isArray: true,
    type: Object,
  })
  keys!: Record<string, string>[];
}
