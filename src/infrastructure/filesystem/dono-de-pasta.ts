import { Injectable } from '@nestjs/common';
import { stat } from 'node:fs/promises';

/** O uid/gid que dono de uma pasta (ADR 0180). */
export interface DonoDePasta {
  uid: number;
  gid: number;
}

/**
 * Mede o DONO da pasta do projeto, para o broker subir o container com esse
 * usuário (ADR 0180). Vive na api porque é ela quem alcança o disco da pasta
 * (montagem por identidade da base, ou a raiz gerenciada); o broker só enxerga
 * o socket do Docker.
 *
 * Devolve `null` — nunca lança — quando não dá para medir (pasta ausente, sem
 * permissão) ou quando o dono é root: "como sempre" é o estado normal, e o
 * broker recusa `0` de propósito.
 */
@Injectable()
export class LeitorDeDonoDePasta {
  async ler(caminho: string): Promise<DonoDePasta | null> {
    try {
      const { uid, gid } = await stat(caminho);
      if (uid <= 0 || gid <= 0) return null;
      return { uid, gid };
    } catch {
      return null;
    }
  }
}
