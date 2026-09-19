import { describe, it, expect } from 'vitest';
import { UnprocessableEntityException } from '@nestjs/common';
import { SendAgentMessageUseCase } from '../../../../src/application/use-cases/agents/send-agent-message.use-case';

// RN-587 (AT-132). A api grava o chat.message ANTES de perguntar ao engine
// (o engine lê o log; a mensagem tem de ser durável com ele fora do ar). A
// recusa do engine é o ÚNICO validador do destinatário — a api não tem lista
// própria — e é o ENGINE quem grava o agent.error ao lado. Aqui se fixa o
// contrato da api: grava primeiro, repassa a recusa sem engolir e sem
// escrever um segundo evento (duplicaria o do engine).
describe('SendAgentMessageUseCase (RN-587)', () => {
  function montar(recusa?: Error) {
    const eventos: Array<{ type: string }> = [];
    const ordem: string[] = [];
    const appendEvent = {
      execute: (_p: string, _s: string, e: { type: string }) => {
        eventos.push(e);
        ordem.push('append');
        return Promise.resolve();
      },
    };
    const engine = {
      sendAgentMessage: () => {
        ordem.push('engine');
        return recusa ? Promise.reject(recusa) : Promise.resolve();
      },
    };
    const uc = new SendAgentMessageUseCase(engine as never, appendEvent as never);
    return { uc, eventos, ordem };
  }

  it('aceite: grava o chat.message e depois pergunta ao engine', async () => {
    const { uc, eventos, ordem } = montar();
    await expect(uc.execute('p', 's', 'po', 'oi', 'u')).resolves.toEqual({ ok: true });
    expect(ordem).toEqual(['append', 'engine']);
    expect(eventos.map((e) => e.type)).toEqual(['chat.message']);
  });

  it('recusa 422 do engine: repassada, e a api não grava evento próprio', async () => {
    const { uc, eventos } = montar(new UnprocessableEntityException('nenhum agente a leu'));
    await expect(uc.execute('p', 's', 'infra', 'oi', 'u')).rejects.toBeInstanceOf(
      UnprocessableEntityException,
    );
    expect(eventos.map((e) => e.type)).toEqual(['chat.message']);
  });
});
