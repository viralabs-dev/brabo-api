import { missingModules } from './module-resolution';

export interface HistoriaParaPendencia {
  id: string;
  title: string;
  status: string;
  moduleIds: string[];
}

export interface PendenciaDeArquitetura {
  storyId: string;
  title: string;
  status: string;
  reason: 'no_module' | 'missing_module';
  missing: string[];
}

/**
 * Pendências de validação cruzada história↔module_map: história SEM módulo ou
 * com módulo que falta no mapa vigente. Fonte única da aba do projeto
 * (`GetArchitectureUseCase`) e da Caixa de decisões (RN-1195).
 */
export function derivarPendenciasDeArquitetura(
  historias: readonly HistoriaParaPendencia[],
  moduleNames: readonly string[],
): PendenciaDeArquitetura[] {
  const pendencias: PendenciaDeArquitetura[] = [];
  for (const h of historias) {
    const base = { storyId: h.id, title: h.title, status: h.status };
    if (h.moduleIds.length === 0) {
      pendencias.push({ ...base, reason: 'no_module', missing: [] });
      continue;
    }
    const missing = missingModules(h.moduleIds, moduleNames);
    if (missing.length > 0) {
      pendencias.push({ ...base, reason: 'missing_module', missing });
    }
  }
  return pendencias;
}
