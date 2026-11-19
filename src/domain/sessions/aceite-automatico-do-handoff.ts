// O aceite AUTOMÁTICO do handoff do PO ao Arquiteto (RN-660, ADR 0186, AT-314).
//
// Puro e sem IO, como `agent-activation.ts`: recebe o que o caso de uso já leu
// e decide SE o aceite pode acontecer sem clique. Quem aceita continua sendo
// `AcceptHandoffUseCase` — é lá que o repositório nasce, antes de
// `activateAgent` (RN-582, ADR 0165) —; aqui só se decide se a pessoa pode ser
// dispensada do clique.
//
// São três perguntas, e as três precisam de "sim":
//
// 1. É a passagem PO → Arquiteto? Nenhuma outra: o aceite ao Arquiteto é o que
//    provisiona o repositório, e é o único que o dono decidiu dispensar.
// 2. O backlog está COBERTO? A definição é OBJETIVA e é a MESMA conta que a aba
//    Backlog mostra (`computeCoverage`): o projeto tem ao menos UMA regra de
//    negócio (`artifact.business_rule`) e NENHUMA regra sem história que a cite
//    em `businessRuleIds` — que é exatamente o que o PO grava com
//    `create_story`, e o que o kickoff dele pede ("cubra TODAS as regras").
//    Zero regras NÃO é coberto: "nada a cobrir" não prova que o PO trabalhou.
// 3. O repositório que o aceite toca é LOCAL e sem credencial? O
//    provisionamento do aceite é sempre `local` (`accept-handoff.use-case.ts`),
//    então projeto SEM repositório passa; projeto com repositório de outro
//    provider, ou com conexão de git (OAuth) cadastrada, continua pedindo o
//    clique — ali há uma credencial em jogo, e ela não é do sistema.
//
// AT-994 (RN-1421..1424) estende o mesmo predicado às duas passagens seguintes,
// cada uma com a chave `automacoes_do_projeto` LIGADA (nasce ligada) e os
// critérios 3 e 4 abaixo:
//
// - Arquiteto → Infra: `module_map` vigente, ADR proposta e NENHUMA pergunta
//   em aberto do Arquiteto;
// - Infra → Dev Lead: toda PR de infra mergeada e o container `running` (a api
//   só registra `running` depois de provar a rede, RN-1366).
//
// E uma quarta, de AUTORIDADE: o aceite é feito em nome de quem abriu a sessão,
// e só se essa pessoa ainda tem o papel que a rota manual exige (`developer`).
// Sem isso o sistema faria por alguém o que a api recusaria a ela.

import { roleAtLeast, type Role } from '../iam/role';

export const AGENTE_QUE_OFERECE_NO_ACEITE_AUTOMATICO = 'po';
export const AGENTE_QUE_RECEBE_NO_ACEITE_AUTOMATICO = 'arquiteto';
/** O mínimo da rota humana de aceite (`agents.controller.ts`, `accept`). */
export const PAPEL_MINIMO_DO_ACEITE: Role = 'developer';

/** O ator de sistema que grava o aceite automático no event log. */
export const ATOR_DO_ACEITE_AUTOMATICO = {
  kind: 'system' as const,
  id: 'handoff-auto-accept',
};

/** A chave da passagem em `automacoes_do_projeto` (categoria `handoff`). */
export const CATEGORIA_DA_PASSAGEM = 'handoff';
export const PASSAGENS_SEM_CLIQUE = [
  'arquiteto->infra',
  'infra->dev-lead',
] as const;
export type PassagemSemClique = (typeof PASSAGENS_SEM_CLIQUE)[number];

/** A chave da passagem, ou `null` se não é uma das duas novas. */
export function passagemDe(
  fromAgent: string,
  toAgent: string,
): PassagemSemClique | null {
  const chave = `${fromAgent}->${toAgent}`;
  return (PASSAGENS_SEM_CLIQUE as readonly string[]).includes(chave)
    ? (chave as PassagemSemClique)
    : null;
}

export type MotivoSemAceiteAutomatico =
  | 'passagem_sem_aceite_automatico'
  | 'passagem_desligada'
  | 'sem_module_map'
  | 'sem_adr_proposta'
  | 'pergunta_em_aberto'
  | 'pr_de_infra_nao_mergeada'
  | 'container_nao_rodando'
  | 'oferta_nao_pendente'
  | 'sem_regras_de_negocio'
  | 'regras_sem_historia'
  | 'repositorio_nao_local'
  | 'credencial_de_git_no_projeto'
  | 'autor_sem_papel';

export interface EntradaDoAceiteAutomatico {
  fromAgent: string;
  toAgent: string;
  status: string;
  cobertura: { regras: number; semHistoria: number };
  /** A chave da passagem Arquiteto→Infra / Infra→Dev Lead está ligada? */
  passagemLigada?: boolean;
  /** Fatos do Arquiteto (ausente = não provado = recusa). */
  arquitetura?: {
    moduleMapVigente: boolean;
    adrProposta: boolean;
    perguntasEmAberto: number;
  };
  /** Fatos da Infra (ausente = não provado = recusa). */
  infra?: { prsMergeadas: boolean; containerRodando: boolean };
  /** O provider do repositório do projeto, ou `null` se ainda não há. */
  providerDoRepositorio: string | null;
  credencialDeGitNoProjeto: boolean;
  /** O papel EFETIVO de quem abriu a sessão no projeto (RN-471). */
  papelDoAutor: Role | null;
}

export type CriterioDoAceite =
  | {
      regras: number;
      cobertas: number;
      repositorio: 'local' | 'a_provisionar_local';
    }
  | {
      passagem: PassagemSemClique;
      repositorio: 'local' | 'a_provisionar_local';
    };

export type DecisaoDoAceiteAutomatico =
  | { aceita: true; criterio: CriterioDoAceite }
  | { aceita: false; motivo: MotivoSemAceiteAutomatico };

/** O backlog está coberto: ≥ 1 regra e nenhuma sem história (RN-660). */
export function backlogCoberto(cobertura: {
  regras: number;
  semHistoria: number;
}): boolean {
  return cobertura.regras > 0 && cobertura.semHistoria === 0;
}

export function decidirAceiteAutomatico(
  e: EntradaDoAceiteAutomatico,
): DecisaoDoAceiteAutomatico {
  const passagem = passagemDe(e.fromAgent, e.toAgent);
  const poParaArquiteto =
    e.fromAgent === AGENTE_QUE_OFERECE_NO_ACEITE_AUTOMATICO &&
    e.toAgent === AGENTE_QUE_RECEBE_NO_ACEITE_AUTOMATICO;
  if (!poParaArquiteto && !passagem) {
    return { aceita: false, motivo: 'passagem_sem_aceite_automatico' };
  }
  if (e.status !== 'offered') {
    return { aceita: false, motivo: 'oferta_nao_pendente' };
  }
  if (poParaArquiteto) {
    if (e.cobertura.regras === 0) {
      return { aceita: false, motivo: 'sem_regras_de_negocio' };
    }
    if (!backlogCoberto(e.cobertura)) {
      return { aceita: false, motivo: 'regras_sem_historia' };
    }
  } else {
    if (!e.passagemLigada) {
      return { aceita: false, motivo: 'passagem_desligada' };
    }
    const motivo =
      passagem === 'arquiteto->infra'
        ? motivoDoArquiteto(e.arquitetura)
        : motivoDaInfra(e.infra);
    if (motivo) return { aceita: false, motivo };
  }
  if (e.providerDoRepositorio !== null && e.providerDoRepositorio !== 'local') {
    return { aceita: false, motivo: 'repositorio_nao_local' };
  }
  if (e.credencialDeGitNoProjeto) {
    return { aceita: false, motivo: 'credencial_de_git_no_projeto' };
  }
  if (!e.papelDoAutor || !roleAtLeast(e.papelDoAutor, PAPEL_MINIMO_DO_ACEITE)) {
    return { aceita: false, motivo: 'autor_sem_papel' };
  }
  const repositorio =
    e.providerDoRepositorio === 'local' ? 'local' : 'a_provisionar_local';
  if (passagem) return { aceita: true, criterio: { passagem, repositorio } };
  return {
    aceita: true,
    criterio: {
      regras: e.cobertura.regras,
      cobertas: e.cobertura.regras - e.cobertura.semHistoria,
      repositorio,
    },
  };
}

function motivoDoArquiteto(
  a: EntradaDoAceiteAutomatico['arquitetura'],
): MotivoSemAceiteAutomatico | null {
  if (!a?.moduleMapVigente) return 'sem_module_map';
  if (!a.adrProposta) return 'sem_adr_proposta';
  if (a.perguntasEmAberto > 0) return 'pergunta_em_aberto';
  return null;
}

function motivoDaInfra(
  i: EntradaDoAceiteAutomatico['infra'],
): MotivoSemAceiteAutomatico | null {
  if (!i?.prsMergeadas) return 'pr_de_infra_nao_mergeada';
  if (!i.containerRodando) return 'container_nao_rodando';
  return null;
}
