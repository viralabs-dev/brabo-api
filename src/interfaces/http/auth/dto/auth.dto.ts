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
  @ApiProperty({ example: 'fulano@brabo.dev', description: 'E-mail da conta.' })
  @IsEmail()
  email!: string;

  @ApiProperty({
    example: 'cavalo bateria grampo correto',
    minLength: COMPRIMENTO_MINIMO,
    description:
      'Senha. Mínimo de 12 caracteres; não há exigência de maiúscula, dígito ou símbolo.',
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

  @ApiProperty({ example: 'cavalo bateria grampo correto' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(COMPRIMENTO_MAXIMO)
  senha!: string;
}

export class RefreshDto {
  @ApiProperty({
    description:
      'O refresh token opaco devolvido no login ou no refresh anterior.',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(512)
  refreshToken!: string;
}

export class VerifyEmailDto {
  @ApiProperty({ description: 'Token de uso único recebido por e-mail.' })
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
  @ApiProperty({ description: 'Token de uso único recebido por e-mail.' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(512)
  token!: string;

  @ApiProperty({
    example: 'outra frase bem comprida',
    minLength: COMPRIMENTO_MINIMO,
  })
  @IsString()
  @MinLength(COMPRIMENTO_MINIMO)
  @MaxLength(COMPRIMENTO_MAXIMO)
  novaSenha!: string;
}

export class SessaoResponseDto {
  @ApiProperty({ description: 'JWT EdDSA de vida curta.' })
  accessToken!: string;

  @ApiProperty({
    description:
      'Token opaco de renovação. Rotaciona a cada uso — reapresentar um já usado revoga a família inteira.',
  })
  refreshToken!: string;

  @ApiProperty({
    example: 900,
    description: 'Segundos até o access token expirar.',
  })
  expiresIn!: number;
}

export class AceiteResponseDto {
  @ApiProperty({
    example: 'Se o endereço estiver disponível, enviamos um e-mail.',
    description:
      'Mensagem genérica, idêntica para endereço conhecido e desconhecido — ver a nota de enumeração na referência.',
  })
  message!: string;
}

export class JwksResponseDto {
  @ApiProperty({
    description: 'Chaves públicas Ed25519 ativas. Durante uma rotação, duas.',
    isArray: true,
    type: Object,
  })
  keys!: Record<string, string>[];
}
