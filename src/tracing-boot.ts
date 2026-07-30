/**
 * O único ponto que LIGA o OpenTelemetry, e existe por causa da ordem de
 * avaliação de módulo.
 *
 * `tracing.ts` exporta `startTracing()` como função pura de propósito, para que
 * um spec possa importá-lo sem registrar estado global (ver o comentário lá). Só
 * que isso não pode ser resolvido chamando a função no corpo do `main.ts`:
 * TypeScript e SWC emitem CommonJS elevando TODOS os `require` para o topo do
 * arquivo, na ordem dos imports, e só depois as demais instruções. Uma linha
 * `startTracing()` escrita entre dois imports rodaria depois de `@nestjs/core`,
 * `pg` e `express` já terem sido carregados — e o monkey-patch não pega em
 * módulo carregado. O sintoma não seria erro, seria ausência de spans.
 *
 * Um módulo separado resolve porque `require` é síncrono: quando `main.ts` faz
 * `import './tracing-boot'` como primeiro import, o corpo deste arquivo roda por
 * inteiro antes de o segundo `require` do `main.ts` começar.
 *
 * Não acrescente nada aqui além da chamada.
 */
import { startTracing } from './tracing';

const { exporting } = startTracing();

// Dito, não inferido. O defeito que o ADR 0035 corrige durou porque "não tem
// trace" e "tem trace, não sai daqui" eram indistinguíveis de fora — e o
// runbook mandava conferir a variável errada.
//
// `console.log` de propósito: isto roda antes de o logger do Nest existir
// (`bufferLogs` só captura o que passa pelo logger do Nest, e aqui ele ainda não
// foi criado).
console.log(
  exporting
    ? 'otel: contexto, propagação e exportação OTLP ativos'
    : 'otel: contexto e propagação ativos, exportação desligada (sem OTEL_EXPORTER_OTLP_ENDPOINT)',
);
