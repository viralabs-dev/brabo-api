import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';

/** Isenta a rota do JwtAuthGuard global (ex.: healthcheck). */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
