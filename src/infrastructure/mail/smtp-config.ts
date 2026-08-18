/**
 * Configuração do transporte SMTP do `MailSender` (backlog "SMTP real no
 * MailSender" — ver ADR 0096).
 *
 * ## `MAIL_TRANSPORT` é o toggle, e o default nunca muda sozinho
 *
 * `MAIL_TRANSPORT` vale `log` (default, inclusive em produção) ou `smtp`.
 * Diferente de `AUTH_JWT_SECRET`/`GIT_OAUTH_STATE_SECRET`/
 * `BRABO_SERVICE_TOKEN`, aqui não existe um segredo "de desenvolvimento" que
 * o `docker-compose.prod.yml` pudesse supotar como fallback perigoso — porque
 * não existe fallback nenhum para suprir: enviar e-mail de verdade é OPT-IN do operador,
 * e sem `MAIL_TRANSPORT=smtp` explícito o comportamento continua o de sempre
 * (log-only), mesmo em produção. Isso também é o que mantém quem já roda o
 * produto hoje sem quebrar nada ao atualizar.
 *
 * ## Validação no padrão da RN-114, com uma diferença
 *
 * As RN-114 originais (`AUTH_JWT_SECRET` e companhia) derrubam o boot em
 * produção porque a variável TEM um default público que mascara o esquecimento
 * — "não vazia" não pegaria o defeito. Aqui não há esse default: `SMTP_HOST`
 * fica em branco se ninguém setar. Por isso a mesma régua (ausente/só
 * espaços/valor de exemplo do repositório/vazia) só é aplicada quando
 * `MAIL_TRANSPORT=smtp` E `NODE_ENV=production` — fora da produção, um
 * operador testando SMTP localmente (contra um MailHog, por exemplo) não é
 * travado no boot; o transporte real só falha quando alguém manda um e-mail de
 * verdade, o que é aceitável fora de produção.
 */

export type ModoDeTransporteDeEmail = 'log' | 'smtp';

export interface ConfigSmtp {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  password: string;
  from: string;
}

/**
 * Publicado (comentado) em `.env.example` como referência de formato — nunca
 * um segredo funcional. Rejeitado mesmo assim se alguém descomentar sem
 * trocar, pela mesma razão do literal de `AUTH_JWT_SECRET`.
 */
const HOST_DE_EXEMPLO = 'smtp.exemplo.com';

const PORTA_PADRAO = 587;

/** Aceita `"Nome <email@dominio>"` ou só `email@dominio`. */
const FORMATO_DE_REMETENTE =
  /^(.+<[^<>@\s]+@[^<>@\s]+\.[^<>@\s]+>|[^<>@\s]+@[^<>@\s]+\.[^<>@\s]+)$/;

export function resolverModoDeTransporte(): ModoDeTransporteDeEmail {
  return process.env.MAIL_TRANSPORT === 'smtp' ? 'smtp' : 'log';
}

function exigirEmProducao(nome: string, valor: string): void {
  if (!valor) {
    throw new Error(
      `${nome} é obrigatória em produção quando MAIL_TRANSPORT=smtp — sem ` +
        'ela o MailSender não tem para onde mandar e-mail de verdade.',
    );
  }
}

/**
 * Resolve a configuração SMTP a partir do ambiente.
 *
 * Só valida contra a régua de produção quando `producao` é `true` — quem
 * chama (o `useFactory` do módulo de auth) já sabe que está em `MAIL_TRANSPORT
 * =smtp`, então não repete essa checagem aqui.
 */
export function resolverConfigSmtp(): ConfigSmtp {
  const producao = process.env.NODE_ENV === 'production';

  const host = (process.env.SMTP_HOST ?? '').trim();
  const user = (process.env.SMTP_USER ?? '').trim();
  const password = (process.env.SMTP_PASSWORD ?? '').trim();
  const from = (process.env.SMTP_FROM ?? '').trim();
  const portaBruta = (process.env.SMTP_PORT ?? '').trim();
  const seguroBruto = (process.env.SMTP_SECURE ?? '').trim().toLowerCase();

  const port = portaBruta ? Number(portaBruta) : PORTA_PADRAO;
  const secure = seguroBruto === 'true';

  if (producao) {
    exigirEmProducao('SMTP_HOST', host);
    if (host === HOST_DE_EXEMPLO) {
      throw new Error(
        'SMTP_HOST está com o valor de exemplo do repositório — configure o ' +
          'host real do seu provedor SMTP.',
      );
    }

    exigirEmProducao('SMTP_USER', user);
    exigirEmProducao('SMTP_PASSWORD', password);
    exigirEmProducao('SMTP_FROM', from);

    if (!FORMATO_DE_REMETENTE.test(from)) {
      throw new Error(
        `SMTP_FROM inválido: "${from}". Use "Nome <email@dominio>" ou só ` +
          '"email@dominio".',
      );
    }

    if (!Number.isInteger(port) || port <= 0 || port > 65535) {
      throw new Error(
        `SMTP_PORT inválida: "${portaBruta}". Use um número entre 1 e 65535.`,
      );
    }
  }

  return { host, port, secure, user, password, from };
}
