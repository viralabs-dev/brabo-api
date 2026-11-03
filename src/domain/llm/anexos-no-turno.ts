// AT-715 (ADR 0246, RN-989): troca a referência de anexo da entrada do
// `llm-turn` pelo conteúdo que o provider lê. Pura: quem lê o banco é o chamador.
import type { ChatMessage, ParteDeConteudo } from '@brabo/shared';

/** Entrada do engine: o anexo vai por id; os bytes nunca saem da api. */
export type ParteDeEntrada = ParteDeConteudo | { type: 'anexo'; id: string };
export type MensagemDeEntrada = Omit<ChatMessage, 'content'> & {
  content: string | ParteDeEntrada[];
};
export interface AnexoLido {
  nome: string;
  mime: string;
  bytes: Buffer;
}

/** O texto de uma mensagem, qualquer que seja a forma do conteúdo. */
export function textoDoConteudo(c: ChatMessage['content']): string {
  return typeof c === 'string'
    ? c
    : c.map((p) => (p.type === 'text' ? p.text : '')).join('\n');
}

export async function resolverAnexos(
  mensagens: MensagemDeEntrada[],
  opcoes: {
    visao: boolean;
    carregar: (id: string) => Promise<AnexoLido | null>;
  },
): Promise<ChatMessage[]> {
  const saida: ChatMessage[] = [];
  for (const m of mensagens) {
    if (typeof m.content === 'string') {
      saida.push(m as ChatMessage);
      continue;
    }
    const partes: ParteDeConteudo[] = [];
    for (const p of m.content) {
      if (p.type !== 'anexo') {
        partes.push(p);
        continue;
      }
      const a = await opcoes.carregar(p.id);
      if (!a) {
        partes.push({ type: 'text', text: `[anexo ${p.id} indisponível]` });
      } else if (!a.mime.startsWith('image/')) {
        partes.push({
          type: 'text',
          text: `[anexo: ${a.nome}]\n${a.bytes.toString('utf8')}\n[fim do anexo: ${a.nome}]`,
        });
      } else if (opcoes.visao) {
        partes.push({
          type: 'image',
          mime: a.mime,
          base64: a.bytes.toString('base64'),
        });
      } else {
        partes.push({
          type: 'text',
          text: `[imagem ${a.nome} não enviada: o modelo atual não lê imagem]`,
        });
      }
    }
    saida.push({ ...m, content: partes });
  }
  return saida;
}
