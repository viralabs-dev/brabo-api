/**
 * A forma mínima de uma JWK de dispositivo (RN-465, RN-552).
 *
 * ## Uma régua, dois registradores
 *
 * Isto nasceu DENTRO de `RegisterRunnerDeviceKeyUseCase`, quando o navegador
 * era o único a registrar chave (ADR 0118). Com a chave de MÁQUINA (ADR 0154)
 * passou a haver um SEGUNDO registrador — o `install.sh`, pela rota interna —,
 * e duas cópias da mesma checagem divergiriam no primeiro dia em que uma delas
 * mudasse. Mesmo motivo pelo qual a política de senha do instalador é a do
 * domínio (ADR 0155 ponto 3): quem valida é o mesmo código, chamado dos dois
 * lugares.
 *
 * ## A validação é MÍNIMA de propósito, com uma exceção
 *
 * Só o suficiente pra recusar cedo o que nunca vai verificar uma assinatura
 * EdDSA (`kty`/`crv`/`x`). Validação profunda — a chave é mesmo um ponto
 * Ed25519 válido — fica pro `jose.importJWK` quando o guard for USAR a chave:
 * duplicá-la aqui não pega nada que a rejeição na emissão do JWT não pegaria
 * depois, e complicaria esta borda sem necessidade.
 *
 * A exceção é `d`, e ela não é sobre forma: é sobre o que NÃO pode ser
 * gravado. `d` é a metade PRIVADA de uma JWK OKP (RFC 8037 §2), e uma privada
 * que chega aqui só chega por engano de quem serializou o par inteiro. Gravá-la
 * seria pôr no banco a única coisa que o desenho das duas espécies de chave
 * promete que nunca viaja — "a privada nunca sai do navegador" (RN-519), "nunca
 * sai da máquina" (ADR 0155 ponto 4). Recusar é a resposta; a mensagem DIZ o
 * que a pessoa mandou, porque um "JWK inválida" genérico faria ela tentar de
 * novo com o mesmo arquivo.
 */
export class JwkDeDispositivoInvalidaError extends Error {}

export function exigirJwkPublicaEd25519(publicKeyJwk: string): void {
  let jwk: unknown;
  try {
    jwk = JSON.parse(publicKeyJwk);
  } catch {
    throw new JwkDeDispositivoInvalidaError(
      'publicKeyJwk não é um JSON válido',
    );
  }

  if (typeof jwk !== 'object' || jwk === null) {
    throw new JwkDeDispositivoInvalidaError(
      'publicKeyJwk precisa ser um objeto JWK',
    );
  }

  const { kty, crv, x, d } = jwk as Record<string, unknown>;
  if (kty !== 'OKP' || crv !== 'Ed25519' || typeof x !== 'string' || !x) {
    throw new JwkDeDispositivoInvalidaError(
      'publicKeyJwk precisa ser uma chave pública Ed25519 (kty "OKP", crv "Ed25519", "x" presente)',
    );
  }

  // Depois de `x`, e não antes: uma JWK que nem é Ed25519 deve ouvir isso
  // primeiro. Quem chega aqui mandou uma Ed25519 completa — o par, não a
  // metade pública.
  if (d !== undefined) {
    throw new JwkDeDispositivoInvalidaError(
      'publicKeyJwk tem "d": isto é a chave PRIVADA, e ela nunca viaja. ' +
        'Mande só a metade pública (kty, crv, x).',
    );
  }
}
