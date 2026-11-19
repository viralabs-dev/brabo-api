export interface AutomacaoDoProjeto {
  categoria: string;
  chave: string;
  ligada: boolean;
  origem: 'padrao' | 'oferta' | 'manual';
  userId: string | null;
  createdAt: Date;
}

/** RN-1421: sem linha, vale o padrão da chave — quem decide o padrão é o domínio. */
export abstract class AutomacaoDoProjetoRepository {
  abstract listar(projectId: string): Promise<AutomacaoDoProjeto[]>;
  abstract definir(input: {
    projectId: string;
    categoria: string;
    chave: string;
    ligada: boolean;
    origem: 'oferta' | 'manual';
    userId: string;
  }): Promise<void>;
}
