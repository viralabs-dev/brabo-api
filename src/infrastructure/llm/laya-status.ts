import { Injectable } from '@nestjs/common';
import {
  RoteadorLocal,
  type EstadoDoLaya,
  type SituacaoDoLaya,
} from '../../application/ports/roteador-local.port';
import { configDoLaya } from './laya-config';

const VALIDADE_MS = 30_000;
const TETO_DA_SONDA_MS = 1000;

/**
 * Lê o `/health` do Laya (a sonda de boot do serviço) e o traduz num dos cinco
 * estados. Cache de 30 s: o turno NUNCA passa por aqui, só a tela e o PUT.
 */
@Injectable()
export class LayaStatus extends RoteadorLocal {
  private ultima: { em: number; s: SituacaoDoLaya } | null = null;

  constructor(private readonly chamar: typeof fetch = fetch) {
    super();
  }

  async situacao(fresco = false): Promise<SituacaoDoLaya> {
    if (!fresco && this.ultima && Date.now() - this.ultima.em < VALIDADE_MS) {
      return this.ultima.s;
    }
    const lida = await this.ler();
    // `desde` só anda quando o estado muda.
    const s: SituacaoDoLaya = {
      ...lida,
      desde:
        this.ultima?.s.estado === lida.estado
          ? this.ultima.s.desde
          : new Date().toISOString(),
    };
    this.ultima = { em: Date.now(), s };
    return s;
  }

  private async ler(): Promise<Omit<SituacaoDoLaya, 'desde'>> {
    const cfg = configDoLaya();
    const vazio: Pick<
      SituacaoDoLaya,
      'dispositivo' | 'vramLivreMiB' | 'p95Ms'
    > = { dispositivo: null, vramLivreMiB: null, p95Ms: null };
    const de = (
      estado: EstadoDoLaya,
      motivo: string | null,
      extra = vazio,
    ) => ({
      estado,
      motivo,
      ...extra,
    });
    if (!cfg.url) return de('nao_configurado', 'TOOL_ROUTER_URL ausente');
    let h: Record<string, unknown>;
    try {
      const r = await this.chamar(`${cfg.url}/health`, {
        headers: cfg.apiKey ? { Authorization: `Bearer ${cfg.apiKey}` } : {},
        signal: AbortSignal.timeout(TETO_DA_SONDA_MS),
      });
      if (!r.ok) return de('sem_resposta', `http_${r.status}`);
      const corpo: unknown = await r.json();
      if (typeof corpo !== 'object' || corpo === null) {
        return de('sem_resposta', 'resposta_invalida');
      }
      h = corpo as Record<string, unknown>;
    } catch (erro) {
      return de('sem_resposta', (erro as Error).name);
    }
    const num = (v: unknown) =>
      typeof v === 'number' && Number.isFinite(v) ? v : null;
    const dispositivo =
      typeof h.dispositivo === 'string' ? h.dispositivo : null;
    const extra = {
      dispositivo,
      vramLivreMiB: num(h.vramLivreMiB),
      p95Ms: num(h.p95Ms),
    };
    if (dispositivo !== 'cuda') return de('sem_gpu', 'sem_gpu', extra);
    if (extra.vramLivreMiB === null || extra.vramLivreMiB < cfg.vramMinMiB) {
      return de('sem_gpu', 'vram_insuficiente', extra);
    }
    if (extra.p95Ms === null || extra.p95Ms > cfg.p95MaxMs) {
      return de('lento', 'p95_acima_do_teto', extra);
    }
    if (h.proficiente === false) {
      return de(
        'lento',
        typeof h.motivo === 'string' ? h.motivo : 'serviço não proficiente',
        extra,
      );
    }
    return de('proficiente', null, extra);
  }
}
