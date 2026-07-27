import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { DrizzleModule } from './infrastructure/persistence/drizzle/drizzle.module';
import { HealthModule } from './interfaces/http/health/health.module';
import { LoggerModule } from 'nestjs-pino';
import { ObservabilityModule } from './infrastructure/observability/observability.module';
import { loggerParams } from './infrastructure/observability/logger.config';
import { ObservabilityHttpModule } from './interfaces/http/observability/observability-http.module';
import { AuthHttpModule } from './interfaces/http/auth/auth-http.module';
import { RateLimitModule } from './interfaces/http/shared/rate-limit.module';
import { IamHttpModule } from './interfaces/http/iam/iam-http.module';
import { SessionsHttpModule } from './interfaces/http/sessions/sessions-http.module';
import { LlmHttpModule } from './interfaces/http/llm/llm-http.module';
import { ActionsHttpModule } from './interfaces/http/actions/actions-http.module';
import { AgentsHttpModule } from './interfaces/http/agents/agents-http.module';
import { BacklogHttpModule } from './interfaces/http/backlog/backlog-http.module';
import { ExecutionHttpModule } from './interfaces/http/execution/execution-http.module';
import { GitHttpModule } from './interfaces/http/git/git-http.module';
import { InternalHttpModule } from './interfaces/http/internal/internal-http.module';
import { PsychologistHttpModule } from './interfaces/http/psychologist/psychologist-http.module';
import { AnamneseHttpModule } from './interfaces/http/anamnese/anamnese-http.module';

@Module({
  // Ordem importa: AuthHttpModule antes de IamHttpModule, para o
  // JwtAuthGuard (popula request.user) rodar antes do RolesGuard
  // (depende dele).
  imports: [
    // PRIMEIRO: substitui o logger default do Nest por JSON estruturado com
    // trace_id, inclusive nas mensagens de boot dos outros módulos.
    LoggerModule.forRoot(loggerParams()),
    DrizzleModule,
    // Antes dos módulos de domínio: eles injetam BraboMetrics.
    ObservabilityModule,
    ObservabilityHttpModule,
    HealthModule,
    AuthHttpModule,
    // DEPOIS do AuthHttpModule, sempre: o rate limit precisa do `request.user`
    // e do `request.clientId` que o JwtAuthGuard popula. Ver o módulo.
    RateLimitModule,
    IamHttpModule,
    SessionsHttpModule,
    LlmHttpModule,
    ActionsHttpModule,
    AgentsHttpModule,
    BacklogHttpModule,
    ExecutionHttpModule,
    GitHttpModule,
    PsychologistHttpModule,
    AnamneseHttpModule,
    InternalHttpModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
