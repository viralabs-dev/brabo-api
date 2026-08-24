import { describe, expect, it } from 'vitest';
import { parseCommand } from '../../../src/domain/actions/command-matcher';
import {
  efeitoExternoNoComando,
  mensagemDeEfeitoExterno,
  comandoPrivilegiadoNoComando,
  mensagemDeComandoPrivilegiado,
} from '../../../src/domain/actions/external-effect';

function efeito(comando: string) {
  return efeitoExternoNoComando(parseCommand(comando));
}

function privilegiado(comando: string) {
  return comandoPrivilegiadoNoComando(parseCommand(comando));
}

describe('efeitoExternoNoComando — o que atravessa a parede do container', () => {
  it.each([
    ['git push origin feature/x', 'git_push'],
    ['git -C /data/ws push', 'git_push'],
    ['git --no-pager push --force', 'git_push'],
    ['git remote add origin git@github.com:acme/x.git', 'git_push'],
    ['git remote set-url origin https://outro', 'git_push'],
    ['git merge dev', 'git_merge'],
    ['gh pr create --title x', 'pr_open'],
    ['gh pr merge 12', 'git_merge'],
    ['gh workflow run deploy.yml', 'deploy'],
    ['kubectl apply -f k8s/', 'deploy'],
    ['helm upgrade brabo ./chart', 'deploy'],
    ['terraform apply -auto-approve', 'deploy'],
    ['docker push ghcr.io/acme/x:1', 'deploy'],
    ['npm publish', 'deploy'],
  ])('%j é efeito externo, e o caminho legítimo é %s', (comando, tipada) => {
    expect(efeito(comando)?.acaoTipada).toBe(tipada);
  });

  it.each([
    'git status',
    'git log --oneline -5',
    'git diff HEAD~1',
    'git remote -v',
    'git commit -m "push do botão"',
    'pnpm test',
    'pnpm run push-notification-spec',
    'ls -la',
    'cat README.md',
  ])('%j NÃO é efeito externo — é trabalho dentro do container', (comando) => {
    expect(efeito(comando)).toBeNull();
  });

  it('um push escondido no fim de um composto ainda é um push', () => {
    // Este é o teste que importa: casar só o primeiro segmento seria a fresta.
    expect(efeito('pnpm test && git push origin main')?.acaoTipada).toBe(
      'git_push',
    );
  });

  it('a mensagem diz qual ação TIPADA usar, não só que não pode', () => {
    const e = efeito('git push');
    expect(e).not.toBeNull();
    expect(mensagemDeEfeitoExterno(e!)).toMatch(/`git_push`/);
    expect(mensagemDeEfeitoExterno(e!)).toMatch(/proposed_action/);
  });
});

describe('comandoPrivilegiadoNoComando — sudo/doas, sem ação tipada equivalente', () => {
  it.each([
    ['sudo apt install htop', 'sudo'],
    ['sudo -u root systemctl restart nginx', 'sudo'],
    ['doas pkg_add htop', 'doas'],
  ])('%j é comando privilegiado (%s)', (comando, verbo) => {
    expect(privilegiado(comando)?.comando).toBe(verbo);
  });

  it.each([
    'echo sudo',
    'pnpm run sudo-check',
    'git commit -m "usa sudo com cautela"',
    'ls -la',
  ])(
    '%j NÃO é comando privilegiado — "sudo" não é o VERBO do segmento',
    (comando) => {
      expect(privilegiado(comando)).toBeNull();
    },
  );

  it('um sudo escondido no fim de um composto ainda é privilegiado', () => {
    expect(privilegiado('echo oi && sudo rm -rf /tmp/x')?.comando).toBe(
      'sudo',
    );
  });

  it('a mensagem explica por que pede decisão humana, sem redirecionar pra ação nenhuma', () => {
    const p = privilegiado('sudo apt install htop');
    expect(p).not.toBeNull();
    const msg = mensagemDeComandoPrivilegiado(p!);
    expect(msg).toMatch(/sudo/);
    expect(msg).toMatch(/proposed_action/);
  });
});
