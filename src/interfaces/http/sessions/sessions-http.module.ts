import { Module } from '@nestjs/common';
import { SessionsController } from './sessions.controller';
import { SessionsUseCasesModule } from '../../../application/use-cases/sessions/sessions-use-cases.module';

@Module({
  imports: [SessionsUseCasesModule],
  controllers: [SessionsController],
})
export class SessionsHttpModule {}
