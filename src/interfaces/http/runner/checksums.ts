/**
 * O manifesto `checksums.txt` publicado ao lado dos binários do runner
 * (ADR 0149, job `checksums` de `build-runner-binaries.yml`) e a leitura pura
 * dele.
 *
 * Separado do controller porque é a única parte da verificação que não faz
 * I/O: parsear texto e comparar dois hexadecimais é função pura, e é o que dá
 * para provar na suíte sem rede nem release publicada.
 */

/** Nome do asset, na Release, que carrega o manifesto. */
export const NOME_DO_MANIFESTO = 'checksums.txt';

/**
 * Nome do asset que carrega a ASSINATURA do manifesto (`cosign sign-blob
 * --bundle`). A api NÃO o lê — está aqui para que o nome tenha uma fonte só e
 * para que a ausência da verificação de assinatura fique visível de dentro do
 * código, e não só na doc. Ver `RunnerReleasesController`, seção "O que esta
 * verificação NÃO faz".
 */
export const NOME_DO_BUNDLE_DE_ASSINATURA = 'checksums.txt.bundle';

/**
 * Por que a recusa vira um CÓDIGO no corpo, e não só um 502.
 *
 * O repositório prefere identificar estado pelo STATUS e nunca casando texto
 * de mensagem, que muda de idioma e um dia diverge (é o raciocínio de
 * `ehPortaoDoContainer`, `apps/web/src/lib/api-client.ts`). Aqui o status
 * sozinho não basta: esta rota tem SEIS desfechos de 502 que o cliente
 * precisa distinguir, e três deles pedem ações diferentes de quem chamou —
 * "essa plataforma não foi publicada" manda esperar a próxima release,
 * "release sem manifesto" manda usar `npm install -g @brabo/runner`
 * ([RN-473](../../../../../../docs/business-rules.md#rn-473)), e "hash
 * divergente" é incidente. Colapsar os três num 502 mudo seria a tela
 * afirmando menos do que a api sabe.
 */
export type MotivoDaRecusa =
  /** A release corrente não tem o binário desta plataforma. */
  | 'plataforma_nao_publicada'
  /** A release corrente não publica `checksums.txt` — nada a verificar contra. */
  | 'release_sem_manifesto'
  /** O manifesto existe mas não cobre esta plataforma (matriz `fail-fast: false`). */
  | 'manifesto_nao_cobre_a_plataforma'
  /** O manifesto existe na listagem, e baixá-lo/lê-lo falhou. */
  | 'manifesto_ilegivel'
  /** O download do binário falhou, ou passou do teto de bytes. */
  | 'download_falhou'
  /** Os bytes baixados não batem com o que o manifesto declara. */
  | 'hash_divergente';

/** O corpo de toda recusa desta rota. */
export interface RecusaDoProxy {
  readonly statusCode: number;
  readonly message: string;
  readonly motivo: MotivoDaRecusa;
}

/**
 * Uma linha de `sha256sum`: 64 hexadecimais, espaço em branco, um `*`
 * opcional (o modo binário do `sha256sum`) e o nome do arquivo.
 *
 * Linha que não casa é IGNORADA em vez de derrubar a leitura: o manifesto é
 * gerado por `sha256sum brabo-runner-*` e pode ganhar cabeçalho ou linha em
 * branco sem que isso signifique adulteração. O que NÃO se tolera é a
 * ausência da linha da plataforma pedida — aí a verificação recusa, e é o
 * chamador que decide o desfecho.
 */
const LINHA = /^([0-9a-f]{64})\s+\*?(\S.*?)\s*$/;

/**
 * Lê o manifesto e devolve `nome do asset -> sha256 em hexadecimal minúsculo`.
 *
 * Nome REPETIDO é recusado colapsando para a última ocorrência? Não: a
 * primeira vence e a segunda é ignorada. Um manifesto com o mesmo nome duas
 * vezes com hashes diferentes é malformado, e "a última vence" deixaria quem
 * escreve o manifesto escolher qual valor a verificação usa — que é
 * exatamente a autoridade que o manifesto não deve ter sobre si mesmo.
 */
export function parsearChecksums(texto: string): Map<string, string> {
  const porNome = new Map<string, string>();
  for (const linha of texto.split('\n')) {
    const casou = LINHA.exec(linha);
    if (!casou) continue;
    const [, hash, nome] = casou;
    if (!porNome.has(nome)) porNome.set(nome, hash);
  }
  return porNome;
}
