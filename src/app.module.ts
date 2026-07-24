import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { DrizzleModule } from './infrastructure/persistence/drizzle/drizzle.module';
import { HealthModule } from './interfaces/http/health/health.module';
import { AuthHttpModule } from './interfaces/http/auth/auth-http.module';
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

@Module({
  // Ordem importa: AuthHttpModule antes de IamHttpModule, para o
  // JwtAuthGuard (popula request.user) rodar antes do RolesGuard
  // (depende dele).
  imports: [
    DrizzleModule,
    HealthModule,
    AuthHttpModule,
    IamHttpModule,
    SessionsHttpModule,
    LlmHttpModule,
    ActionsHttpModule,
    AgentsHttpModule,
    BacklogHttpModule,
    ExecutionHttpModule,
    GitHttpModule,
    PsychologistHttpModule,
    InternalHttpModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
