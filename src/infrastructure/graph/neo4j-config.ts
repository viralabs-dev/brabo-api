/**
 * Configuração de conexão do grafo de conhecimento (Neo4j).
 *
 * ## Por que este toggle NÃO é igual ao do `MAIL_TRANSPORT`
 *
 * `MAIL_TRANSPORT` tem um default (`log`) que continua válido mesmo em
 * produção, porque mandar e-mail de verdade é um EFEITO opt-in do operador —
 * sem a variável, nada de errado acontece, o produto só loga. O grafo é
 * infraestrutura de leitura/escrita interna: quando alguém configura
 * `NODE_ENV=production`, a expectativa é que o grafo exista e a api não suba
 * "quase funcionando" com ele ausente sem avisar. Por isso a regra desta
 * fundação é mais simples e mais dura: em produção as três variáveis são
 * OBRIGATÓRIAS (falha cedo, no boot); fora dela (dev/test/CI) a ausência é
 * um estado válido — ninguém precisa subir um Neo4j local só para rodar a
 * suite, e o `GraphStore` degrada sozinho (ver `graph-store.ts`).
 *
 * ## Por que não existe "valor de exemplo" a recusar
 *
 * Diferente de `AUTH_JWT_SECRET`/`SMTP_HOST`, não há segredo público
 * plausível para uma URI Neo4j — `bolt://localhost:7687` é ao mesmo tempo o
 * valor de desenvolvimento correto E o único formato razoável. Recusar um
 * "valor de exemplo" aqui seria inventar uma regra sem defeito real por trás.
 */

export interface ConfigNeo4j {
  uri: string;
  user: string;
  password: string;
}

function exigirEmProducao(nome: string, valor: string): void {
  if (!valor) {
    throw new Error(
      `${nome} é obrigatória em produção — sem ela a api não tem para onde ` +
        'conectar o grafo de conhecimento (Neo4j).',
    );
  }
}

/**
 * `null` = grafo desligado (nenhuma tentativa de conexão é feita). Fora de
 * produção, configuração AUSENTE OU PARCIAL degrada para desligado — só em
 * produção a ausência de qualquer uma das três derruba o boot.
 */
export function resolverConfigNeo4j(): ConfigNeo4j | null {
  const producao = process.env.NODE_ENV === 'production';

  const uri = (process.env.NEO4J_URI ?? '').trim();
  const user = (process.env.NEO4J_USER ?? '').trim();
  const password = (process.env.NEO4J_PASSWORD ?? '').trim();

  if (producao) {
    exigirEmProducao('NEO4J_URI', uri);
    exigirEmProducao('NEO4J_USER', user);
    exigirEmProducao('NEO4J_PASSWORD', password);
    return { uri, user, password };
  }

  if (!uri || !user || !password) return null;
  return { uri, user, password };
}
