import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { GraphStore } from '../../infrastructure/graph/graph-store';
import { GetModuleContractsUseCase } from '../use-cases/architecture/get-module-contracts.use-case';
import { ReadProjectCodeUseCase } from '../use-cases/git/read-project-code.use-case';

const PASTA_DOS_CARTOES = '.brabo/memoria/modulos';
const ARQUIVO_DE_DECISOES = '.brabo/memoria/decisoes.md';
/** Teto de cartões por merge (leitura contida, ADR 0060). */
const MAX_CARTOES = 200;

export interface CartaoDeModulo {
  nome: string;
  stack: string | null;
  commit: string | null;
  dependeDe: string[];
  expoe: { assinatura: string; tipo: string }[];
}

export interface DecisaoDaMemoria {
  id: string;
  titulo: string;
  modulos: string[];
}

/** Front-matter + seção `## Expõe` do cartão (formato do `MemoriaExtrator` do engine). `null` = malformado. */
export function interpretarCartao(texto: string): CartaoDeModulo | null {
  const fm = /^---\n([\s\S]*?)\n---/.exec(texto)?.[1];
  if (fm === undefined) return null;
  const campo = (chave: string) =>
    new RegExp(`^${chave}:[ \\t]*(.*)$`, 'm').exec(fm)?.[1].trim() || null;
  const nome = campo('modulo');
  if (!nome) return null;
  const lista = /^depende_de:[ \t]*\[(.*)\]$/m.exec(fm)?.[1] ?? '';
  const dependeDe = [
    ...new Set(
      lista
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    ),
  ];

  const expoe = new Map<string, string>();
  let naSecao = false;
  for (const linha of texto.split('\n')) {
    if (/^## /.test(linha) || linha.startsWith('<!-- /brabo:gerado')) {
      naSecao = /^## Expõe\s*$/.test(linha);
      continue;
    }
    const m = naSecao ? /^- `(.+)` \(([^)]+)\)\s*$/.exec(linha) : null;
    if (m) expoe.set(m[1], m[2]);
  }
  return {
    nome,
    stack: campo('stack'),
    commit: campo('commit'),
    dependeDe,
    expoe: [...expoe].map(([assinatura, tipo]) => ({ assinatura, tipo })),
  };
}

const escapar = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * `decisoes.md`: uma linha por ADR ("- ADR 0123 — título", ou `| 0123 |`).
 * O módulo é citado quando o nome aparece na linha, entre crases ou como palavra.
 */
export function interpretarDecisoes(
  texto: string,
  modulos: string[],
): DecisaoDaMemoria[] {
  const porId = new Map<string, DecisaoDaMemoria>();
  for (const linha of texto.split('\n')) {
    if (!/^\s*[-*|]/.test(linha)) continue;
    const id = /(?:ADR[\s-]*|^[\s\-*|]*)(\d{3,4})\b/i.exec(linha)?.[1];
    if (!id) continue;
    const citados = modulos.filter((m) =>
      new RegExp(`(^|[^\\w-])${escapar(m)}($|[^\\w-])`).test(linha),
    );
    porId.set(id, {
      id,
      titulo: linha.replace(/^[\s\-*|]+/, '').trim(),
      modulos: citados,
    });
  }
  return [...porId.values()];
}

/**
 * Projeta `.brabo/memoria/` no grafo (RN-1150..1153, ADR 0293): módulos,
 * dependências, interfaces, versão do contrato (do BANCO) e decisões. `MERGE`
 * em chave natural; o grafo converge para a `main` (o que sumiu do cartão sai).
 * Pasta ausente = nada a fazer. Cartão malformado = pulado com log.
 */
@Injectable()
export class MemoriaDoProjetoTranslator {
  private readonly logger = new Logger(MemoriaDoProjetoTranslator.name);

  constructor(
    private readonly readCode: ReadProjectCodeUseCase,
    private readonly contratos: GetModuleContractsUseCase,
    private readonly graph: GraphStore,
  ) {}

  /** `ref` vazio = ponta da branch padrão. Devolve `false` quando não há memória. */
  async projetar(projectId: string, ref?: string): Promise<boolean> {
    const alvo = ref || undefined;
    const caminhos = await this.listarCartoes(projectId, alvo);
    const decisoesTexto = await this.lerOuNulo(
      projectId,
      ARQUIVO_DE_DECISOES,
      alvo,
    );
    if (caminhos.length === 0 && decisoesTexto === null) return false;

    const cartoes: CartaoDeModulo[] = [];
    for (const caminho of caminhos) {
      const texto = await this.lerOuNulo(projectId, caminho, alvo);
      const cartao = texto === null ? null : interpretarCartao(texto);
      if (cartao) cartoes.push(cartao);
      else
        this.logger.warn(`Cartão malformado ou ilegível, pulado: ${caminho}`);
    }

    const estado = await this.contratos.execute(projectId);
    const versao = estado.status === 'declarados' ? estado.version : null;
    const nomes = cartoes.map((c) => c.nome);
    const decisoes = decisoesTexto
      ? interpretarDecisoes(decisoesTexto, nomes)
      : [];
    const todos = [
      ...new Set([...nomes, ...cartoes.flatMap((c) => c.dependeDe)]),
    ];

    await this.graph.executeWrite(async (tx) => {
      for (const c of cartoes) {
        await tx.run(
          `MERGE (p:Projeto {id: $projectId})
           MERGE (m:Modulo {projectId: $projectId, nome: $nome})
           SET m.stack = $stack, m.commit = $commit
           MERGE (p)-[:TEM_MODULO]->(m)
           WITH m
           OPTIONAL MATCH (m)-[d:DEPENDE_DE]->(:Modulo) DELETE d
           WITH DISTINCT m
           OPTIONAL MATCH (m)-[:EXPOE]->(i:Interface) DETACH DELETE i
           WITH DISTINCT m
           OPTIONAL MATCH (m)-[t:TEM_CONTRATO]->(:Contrato) DELETE t`,
          { projectId, nome: c.nome, stack: c.stack, commit: c.commit },
        );
        for (const dep of c.dependeDe) {
          await tx.run(
            `MATCH (m:Modulo {projectId: $projectId, nome: $nome})
             MERGE (d:Modulo {projectId: $projectId, nome: $dep})
             MERGE (m)-[:DEPENDE_DE]->(d)`,
            { projectId, nome: c.nome, dep },
          );
        }
        for (const i of c.expoe) {
          await tx.run(
            `MATCH (m:Modulo {projectId: $projectId, nome: $nome})
             MERGE (i:Interface {projectId: $projectId, modulo: $nome, assinatura: $assinatura})
             SET i.tipo = $tipo
             MERGE (m)-[:EXPOE]->(i)`,
            { projectId, nome: c.nome, ...i },
          );
        }
        if (versao !== null) {
          await tx.run(
            `MATCH (m:Modulo {projectId: $projectId, nome: $nome})
             MERGE (c:Contrato {projectId: $projectId, modulo: $nome, versao: $versao})
             MERGE (m)-[:TEM_CONTRATO]->(c)`,
            { projectId, nome: c.nome, versao },
          );
        }
      }
      // Converge: módulo, contrato e decisão que saíram da `main` saem do grafo.
      await tx.run(
        `MATCH (m:Modulo {projectId: $projectId}) WHERE NOT m.nome IN $todos DETACH DELETE m`,
        { projectId, todos },
      );
      await tx.run(
        `MATCH (c:Contrato {projectId: $projectId})
         WHERE NOT c.modulo IN $nomes OR $versao IS NULL OR c.versao <> $versao
         DETACH DELETE c`,
        { projectId, nomes, versao },
      );
      await tx.run(
        `MATCH (d:Decisao {projectId: $projectId}) DETACH DELETE d`,
        {
          projectId,
        },
      );
      for (const d of decisoes) {
        await tx.run(
          `MERGE (d:Decisao {projectId: $projectId, id: $id})
           SET d.titulo = $titulo
           WITH d
           UNWIND $modulos AS nome
           MATCH (m:Modulo {projectId: $projectId, nome: nome})
           MERGE (d)-[:CITA]->(m)`,
          { projectId, id: d.id, titulo: d.titulo, modulos: d.modulos },
        );
      }
    });
    return true;
  }

  private async listarCartoes(
    projectId: string,
    ref?: string,
  ): Promise<string[]> {
    try {
      const arvore = await this.readCode.tree(
        projectId,
        ref,
        PASTA_DOS_CARTOES,
      );
      return arvore.entries
        .filter((e) => e.type !== 'dir' && e.path.endsWith('.md'))
        .map((e) => e.path)
        .slice(0, MAX_CARTOES);
    } catch (erro) {
      if (erro instanceof NotFoundException) return [];
      throw erro;
    }
  }

  private async lerOuNulo(projectId: string, caminho: string, ref?: string) {
    try {
      return (await this.readCode.file(projectId, caminho, ref)).content;
    } catch (erro) {
      if (erro instanceof NotFoundException) return null;
      throw erro;
    }
  }
}
