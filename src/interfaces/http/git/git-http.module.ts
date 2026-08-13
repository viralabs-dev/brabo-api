import { Module } from '@nestjs/common';
import { GitUseCasesModule } from '../../../application/use-cases/git/git-use-cases.module';
import { GitController } from './git.controller';
import { GitCredentialsController } from './git-credentials.controller';
import { CodeController } from './code.controller';

@Module({
  imports: [GitUseCasesModule],
  controllers: [GitController, GitCredentialsController, CodeController],
})
export class GitHttpModule {}
