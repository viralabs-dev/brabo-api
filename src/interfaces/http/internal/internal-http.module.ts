import { Module } from '@nestjs/common';
import { SessionsUseCasesModule } from '../../../application/use-cases/sessions/sessions-use-cases.module';
import { InternalSessionsController } from './internal-sessions.controller';

@Module({
  imports: [SessionsUseCasesModule],
  controllers: [InternalSessionsController],
})
export class InternalHttpModule {}
