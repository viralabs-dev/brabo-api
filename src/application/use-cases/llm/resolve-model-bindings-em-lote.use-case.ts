import { Injectable } from '@nestjs/common';
import { ResolveModelBindingUseCase } from './resolve-model-binding.use-case';
import type { ResolvedBinding } from '../../../domain/llm/binding-resolver';

/**
 * Teto de chaves (agentes + áreas) numa leitura em lote (RN-654). A leitura é
 * contida como toda leitura (ADR 0060): cada chave custa uma resolução da
 * cascata, e sem teto a rota viraria um amplificador de consultas escolhido
 * pelo cliente. A tela de Configurações pede 20 (17 agentes e 3 áreas); o teto
 * deixa folga para os `dev-<modulo>` sem deixar a lista crescer sem dono.
 */
export const TETO_DE_CHAVES_NO_LOTE = 64;

/**
 * O formato de uma chave de agente ou de área — o mesmo alfabeto dos slugs do
 * catálogo (`agent-areas.ts`) e dos `dev-<modulo>`. Ele existe aqui, e não nas
 * rotas individuais, porque aqui a chave chega numa LISTA separada por vírgula:
 * sem o formato, uma vírgula ou um `:` dentro de uma chave mudaria a pergunta
 * em silêncio (o `:` é o separador de `chaveDeAgente`).
 */
const FORMATO_DE_CHAVE = /^[a-z0-9][a-z0-9_-]{0,63}$/;

export class LoteDeBindingsInvalidoError extends Error {
  constructor(motivo: string) {
    super(motivo);
    this.name = 'LoteDeBindingsInvalidoError';
  }
}

/**
 * Lê uma lista `a,b,c` vinda da query. Ausente ou vazia é lista vazia (a tela
 * pode pedir só agentes, ou só áreas); repetida é deduplicada na ordem em que
 * chegou; chave fora do formato RECUSA nomeando a chave — nunca é descartada
 * calada, porque a resposta então afirmaria sobre menos chaves do que a tela
 * pediu.
 */
export function lerListaDeChaves(bruto: string | undefined): string[] {
  if (!bruto) return [];
  const chaves: string[] = [];
  for (const parte of bruto.split(',')) {
    const chave = parte.trim();
    if (!chave) continue;
    if (!FORMATO_DE_CHAVE.test(chave)) {
      throw new LoteDeBindingsInvalidoError(
        `Chave inválida no lote: "${chave}". Use letras minúsculas, dígitos, "-" ou "_".`,
      );
    }
    if (!chaves.includes(chave)) chaves.push(chave);
  }
  return chaves;
}

export interface BindingResolvidoDaChave {
  key: string;
  binding: ResolvedBinding | null;
}

export interface BindingsResolvidosEmLote {
  agents: BindingResolvidoDaChave[];
  areas: BindingResolvidoDaChave[];
}

/**
 * As ligações de modelo RESOLVIDAS de vários agentes e áreas de um projeto,
 * numa leitura só (RN-654, AT-334).
 *
 * Não há cascata nova aqui: cada chave passa por `ResolveModelBindingUseCase`
 * com EXATAMENTE a entrada que a rota individual passaria —
 * `{ projectId, agentId }` para agente e `{ projectId, areaKey }` para área —,
 * então o que o lote devolve para uma chave é, byte a byte, o que
 * `GET .../agent-bindings/:slug` ou `GET .../area-bindings/:key` devolveria,
 * inclusive a herança do Criativo (`herdarModeloDeStart`) e o `null` de quem
 * não tem modelo em nível nenhum. O ganho é de REQUISIÇÕES do navegador (o
 * teto de 300/min é do usuário, RN-579), não de consultas ao banco.
 */
@Injectable()
export class ResolveModelBindingsEmLoteUseCase {
  constructor(private readonly resolver: ResolveModelBindingUseCase) {}

  async execute(input: {
    projectId: string;
    agentes: string[];
    areas: string[];
  }): Promise<BindingsResolvidosEmLote> {
    const total = input.agentes.length + input.areas.length;
    if (total > TETO_DE_CHAVES_NO_LOTE) {
      throw new LoteDeBindingsInvalidoError(
        `O lote pede ${total} chaves; o teto é ${TETO_DE_CHAVES_NO_LOTE}.`,
      );
    }

    const [agents, areas] = await Promise.all([
      Promise.all(
        input.agentes.map(async (key) => ({
          key,
          binding: await this.resolver.execute({
            projectId: input.projectId,
            agentId: key,
          }),
        })),
      ),
      Promise.all(
        input.areas.map(async (key) => ({
          key,
          binding: await this.resolver.execute({
            projectId: input.projectId,
            areaKey: key,
          }),
        })),
      ),
    ]);
    return { agents, areas };
  }
}
