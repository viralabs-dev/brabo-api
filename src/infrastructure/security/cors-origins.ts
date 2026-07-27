/**
 * Resolve a lista de origens aceitas pelo CORS (Fase 5, item 7).
 *
 * ## O que mudou e por quê
 *
 * Antes: `origin: process.env.WEB_ORIGIN ?? 'http://localhost:5173'`. Uma
 * origem só, e — o problema de verdade — um default de desenvolvimento que
 * valia igual em produção. Esquecer de definir `WEB_ORIGIN` num deploy não
 * quebrava nada de forma visível: a api simplesmente passava a aceitar uma
 * origem de localhost, e ninguém percebia até alguém procurar.
 *
 * Agora:
 *
 * - `WEB_ORIGIN` aceita LISTA separada por vírgula. Ambientes reais têm mais de
 *   uma origem legítima (domínio principal e o de preview, por exemplo), e a
 *   alternativa era um regex — que é como `*` entra sem ninguém notar.
 * - Em produção não há default e não se aceita `*`: o boot FALHA. Um erro no
 *   start é barulhento e reversível; uma api permissiva é silenciosa e não é.
 */
const DEFAULT_DEV_ORIGIN = 'http://localhost:5173';

export function resolveCorsOrigins(): string[] {
  const producao = process.env.NODE_ENV === 'production';
  const bruto = (process.env.WEB_ORIGIN ?? '').trim();

  if (!bruto) {
    if (producao) {
      throw new Error(
        'WEB_ORIGIN é obrigatória em produção — sem ela a api não sabe qual origem aceitar, ' +
          'e um default de desenvolvimento seria permissivo sem aviso.',
      );
    }
    return [DEFAULT_DEV_ORIGIN];
  }

  const origens = bruto
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);

  if (producao && origens.includes('*')) {
    throw new Error(
      'WEB_ORIGIN não pode ser "*" em produção: com `credentials: true` isso ' +
        'expõe as respostas autenticadas a qualquer origem.',
    );
  }

  if (origens.length === 0) {
    throw new Error(`WEB_ORIGIN inválida: "${bruto}"`);
  }

  return origens;
}
