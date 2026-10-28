import { Module } from '@nestjs/common';
import { SessionsController } from './sessions.controller';
import { AgentResumeController } from './agent-resume.controller';
import { GitUseCasesModule } from '../../../application/use-cases/git/git-use-cases.module';
import { SessionsUseCasesModule } from '../../../application/use-cases/sessions/sessions-use-cases.module';

@Module({
  imports: [SessionsUseCasesModule, GitUseCasesModule],
  controllers: [SessionsController, AgentResumeController],
})
export class SessionsHttpModule {}
