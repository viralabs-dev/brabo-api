import helmet from 'helmet';

export type HelmetOptions = NonNullable<Parameters<typeof helmet>[0]>;

/**
 * Opções do helmet (Fase 5, item 7), extraídas do `main.ts` para poderem ser
 * TESTADAS — antes eram um literal no boot, e nenhum teste via qual cabeçalho a
 * api mandava de verdade.
 *
 * ## Por que o CSP deixou de ser `false`
 *
 * O argumento antigo estava escrito no `main.ts` e era coerente até certo
 * ponto: esta api serve JSON, quem executa script é a web, e o CSP dela já
 * existe e é mais específico (docker/web/nginx.conf). Ligar um CSP GENÉRICO
 * aqui daria impressão de cobertura sem acrescentar defesa.
 *
 * O que o argumento não considerou é que a alternativa a um CSP genérico não é
 * cabeçalho nenhum — é um CSP ESPECÍFICO, e para uma api JSON o específico é o
 * mais fechado que existe: `default-src 'none'`. Uma api que serve JSON não
 * carrega script, folha de estilo, imagem, fonte nem frame, então negar tudo
 * não custa comportamento algum. E resposta de api VIRA superfície de execução
 * em dois casos concretos que o CSP da web não cobre, porque nesses casos a web
 * não está no caminho:
 *
 * - navegação direta a uma rota da api (link colado, redirect, aba aberta pelo
 *   próprio usuário) — a resposta é renderizada pelo browser na ORIGEM DA API,
 *   onde o CSP do nginx da web não vale;
 * - `frame-ancestors`, que só tem efeito no documento emoldurado. Nenhum CSP da
 *   web impede que um terceiro emoldure uma rota da api.
 *
 * `frame-ancestors 'none'`, `base-uri 'none'` e `form-action 'none'` fecham
 * respectivamente clickjacking, sequestro de URL relativa e submissão de
 * formulário — todos sobre um documento que só existe nesse caminho de
 * navegação direta.
 *
 * ## Os dois perfis
 *
 * Em produção o CSP é o cadeado acima. Fora de produção o `main.ts` monta o
 * Swagger UI em `/docs`, que é HTML de verdade e precisa de script, estilo e
 * imagem próprios — sob `default-src 'none'` a página abriria em branco. Por
 * isso o perfil de desenvolvimento afrouxa o necessário para o Swagger e nada
 * além, e a condição é EXATAMENTE a mesma que monta o Swagger
 * (`NODE_ENV !== 'production'`): se um dia o Swagger passar a subir em
 * produção, o CSP acompanha em vez de silenciosamente barrá-lo.
 *
 * `'unsafe-inline'` aparece só no perfil de desenvolvimento, e é uma limitação
 * do Swagger UI (ele injeta o inicializador inline), não uma escolha nossa.
 *
 * ## `crossOriginResourcePolicy`
 *
 * Continua permitindo consumo cross-origin — a web é OUTRA origem e o default
 * `same-origin` do helmet bloquearia o app inteiro, com o sintoma confundido
 * com erro de CORS. O que mudou é que isso passou a ser DITO
 * (`policy: 'cross-origin'`) em vez de omitido (`false`): mesmo efeito no
 * browser, mas a intenção fica no cabeçalho em vez de na ausência dele.
 */
export function helmetOptions(): HelmetOptions {
  return {
    contentSecurityPolicy: {
      useDefaults: false,
      directives: cspDirectives(),
    },
    crossOriginResourcePolicy: { policy: 'cross-origin' },
  };
}

/** Exportado para o teste conseguir afirmar sobre os dois perfis. */
export function cspDirectives(): Record<string, string[]> {
  if (process.env.NODE_ENV === 'production') {
    return {
      'default-src': ["'none'"],
      'frame-ancestors': ["'none'"],
      'base-uri': ["'none'"],
      'form-action': ["'none'"],
    };
  }

  // Perfil do Swagger UI: o mínimo para a página de `/docs` funcionar.
  return {
    'default-src': ["'none'"],
    'script-src': ["'self'", "'unsafe-inline'"],
    'style-src': ["'self'", "'unsafe-inline'"],
    'img-src': ["'self'", 'data:'],
    'font-src': ["'self'", 'data:'],
    'connect-src': ["'self'"],
    'frame-ancestors': ["'none'"],
    'base-uri': ["'none'"],
    'form-action': ["'self'"],
  };
}
