// Promoção de story (Fase 12c): O QUE se valida para uma story sair de
// `draft` para `ready`, num lugar só.
//
// Existe porque a validação estava DUPLICADA e ASSIMÉTRICA: a criação
// (`CreateStoryUseCase`) chamava só `canBecomeReady`, enquanto a transição
// (`TransitionStoryUseCase`) chamava `assertReady` + `assertModulesResolved`.
// Duas portas para o mesmo estado, com fechaduras diferentes.
//
// A Fase 12c torna QUEM dispara a promoção configurável por projeto (o PO
// automaticamente, ou o usuário à mão) — e por isso o que é validado tem de
// deixar de depender de por onde se entra. Este módulo é essa garantia; o
// teste de simetria em `story-promotion.spec.ts` é o que a mantém.
//
// Puro e sem IO, como os dois que ele compõe.

import {
  assertReady,
  missingForReady,
  type ReadinessRequirement,
  type StoryReadinessView,
} from './story-readiness';
import { assertModulesResolved } from '../architecture/module-resolution';

/** O mínimo que uma story precisa expor para ser avaliada. */
export interface StoryPromotionView extends StoryReadinessView {
  moduleIds: string[];
}

/**
 * Levanta `StoryNotReadyError` (DoD/DoR/RF/regra) ou
 * `StoryModulesMissingError` (módulo fora do module_map vigente).
 *
 * A ordem importa: prontidão primeiro, porque é a falha que o autor da story
 * consegue corrigir sozinho; módulo faltante depende do Arquiteto.
 *
 * `moduleIds` vazio PASSA, e isso é intencional (documentado em
 * `module-resolution.ts` desde a Fase 3b): na criação a story ainda não tem
 * módulos — quem os atribui é o Arquiteto, depois. Sem isso, ligar esta
 * validação ao caminho de criação faria o modo `auto` nunca mais promover
 * nada, quebrando em silêncio quem depende dele.
 */
export function assertPromotable(
  story: StoryPromotionView,
  moduleNames: readonly string[],
): void {
  assertReady(story);
  assertModulesResolved(story.moduleIds, moduleNames);
}

/**
 * A mesma decisão, sem levantar — para a criação em modo `auto`, que precisa
 * escolher entre promover e deixar em draft sem tratar exceção, e para a UI
 * decidir se habilita o botão de promover.
 */
export function isPromotable(
  story: StoryPromotionView,
  moduleNames: readonly string[],
): boolean {
  return (
    missingForReady(story).length === 0 &&
    story.moduleIds.every((id) => moduleNames.includes(id))
  );
}

/** O que falta, para a UI dizer POR QUE não dá para promover. */
export function missingForPromotion(
  story: StoryPromotionView,
  moduleNames: readonly string[],
): { readiness: ReadinessRequirement[]; modules: string[] } {
  const known = new Set(moduleNames);
  return {
    readiness: missingForReady(story),
    modules: story.moduleIds.filter((id) => !known.has(id)),
  };
}
