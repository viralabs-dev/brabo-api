/**
 * Migração dos usuários do Keycloak (Fase 7a, item 4).
 *
 * ## Não conecta no Keycloak, e isso não é atalho
 *
 * O `JwtAuthGuard` fazia upsert de todo usuário em `users` a cada requisição
 * desde a Fase 1 — id, e-mail e os vínculos de RBAC em `workspace_members` e
 * `project_members` sempre estiveram no banco da api. O Keycloak nunca foi a
 * fonte da verdade do RBAC; era só o emissor do token. Não há nada para
 * importar: o que falta a essas contas é uma SENHA, que o Keycloak também não
 * daria (hash de senha não migra — está no CLAUDE.md e no ADR 0031).
 *
 * Migrar, portanto, é emitir um link de "definir senha" para quem tem
 * `keycloak_sub` e não tem credencial.
 *
 * ## Idempotência
 *
 * Duas travas, e as duas importam:
 *
 * - pula quem já tem credencial (já definiu senha, ou nunca foi do Keycloak);
 * - pula quem já tem um `set_initial_password` VIVO. Sem isto, a segunda
 *   execução invalidaria os links já enviados — o `emitir` faz supersede —, e
 *   quem clicasse no link do primeiro e-mail veria "link inválido".
 *
 * ## Onde os links aparecem
 *
 * Depende de `MAIL_TRANSPORT` (backlog "SMTP real no MailSender", ADR 0096):
 * em `log` (default) vão para o log da api, não para caixa de entrada — com
 * `AUTH_MAIL_LOG_TOKENS=true` o token sai no log, sem ela sai só o
 * destinatário; em `smtp` vão para o e-mail de verdade. O script não escolhe
 * o modo — usa o `MailSender` que a DI resolveu, o mesmo que qualquer outro
 * caso de uso de auth. Ver o runbook.
 *
 * Uso: pnpm --filter api migrate:keycloak-users
 */
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { AccountTokenRepository } from '../application/ports/account-token-repository.port';
import { AuthCredentialRepository } from '../application/ports/auth-credential-repository.port';
import { AuthEventRecorder } from '../application/ports/auth-event-recorder.port';
import { MailSender } from '../application/ports/mail-sender.port';
import { TokenFactory } from '../application/use-cases/auth/token-factory';
import { authConfig } from '../application/use-cases/auth/auth-config';
import { assuntoDoUsuario } from '../domain/auth/auth-event';

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn'],
  });

  const credenciais = app.get(AuthCredentialRepository);
  const tokensDeConta = app.get(AccountTokenRepository);
  const eventos = app.get(AuthEventRecorder);
  const mail = app.get(MailSender);
  const tokenFactory = app.get(TokenFactory);

  const pendentes = await credenciais.listarPendentesDeSenha();
  console.log(`Usuários do Keycloak sem senha nesta api: ${pendentes.length}`);

  let emitidos = 0;
  let pulados = 0;

  for (const { userId, email } of pendentes) {
    if (await tokensDeConta.existeVivo(userId, 'set_initial_password')) {
      pulados += 1;
      console.log(`  pulado  ${email} — já tem link válido em aberto`);
      continue;
    }

    const token = tokenFactory.gerar();
    const expiraEm = new Date(Date.now() + authConfig.definicaoDeSenhaTtlMs());

    await tokensDeConta.emitir({
      userId,
      purpose: 'set_initial_password',
      tokenHash: token.hash,
      expiresAt: expiraEm,
    });
    await eventos.registrar({
      kind: 'password_reset_requested',
      subjectKey: assuntoDoUsuario(userId),
      userId,
      metadata: { origem: 'migracao_keycloak' },
    });
    await mail.enviar({
      para: email,
      tipo: 'set_initial_password',
      token: token.bruto,
      expiraEm,
    });

    emitidos += 1;
    console.log(`  emitido ${email} — expira em ${expiraEm.toISOString()}`);
  }

  console.log(
    `\n✓ ${emitidos} link(s) emitido(s), ${pulados} pulado(s). ` +
      `Rodar de novo não duplica.`,
  );

  if (emitidos > 0 && process.env.AUTH_MAIL_LOG_TOKENS !== 'true') {
    console.log(
      '\nOs tokens NÃO foram impressos: AUTH_MAIL_LOG_TOKENS não está ligada. ' +
        'Com SMTP ainda não configurado, ligue-a para extrair os links do log ' +
        '— e desligue depois. Ver docs/runbook.md.',
    );
  }

  await app.close();
}

void main();
