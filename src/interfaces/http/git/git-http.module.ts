import { Module } from '@nestjs/common';
import { GitUseCasesModule } from '../../../application/use-cases/git/git-use-cases.module';
import { GitController } from './git.controller';

@Module({
  imports: [GitUseCasesModule],
  controllers: [GitController],
})
export class GitHttpModule {}
