import { Module } from '@nestjs/common';
import { SessionsUseCasesModule } from '../../../application/use-cases/sessions/sessions-use-cases.module';
import { SessionTerminationController } from './session-termination.controller';

@Module({
  imports: [SessionsUseCasesModule],
  controllers: [SessionTerminationController],
})
export class InternalHttpModule {}
