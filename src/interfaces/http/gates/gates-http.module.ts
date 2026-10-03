import { Module } from '@nestjs/common';
import { ResumeParkedGateUseCase } from '../../../application/use-cases/gates/resume-parked-gate.use-case';
import { GateResumeController } from './gate-resume.controller';
import { GatesController } from './gates.controller';

@Module({
  controllers: [GatesController, GateResumeController],
  providers: [ResumeParkedGateUseCase],
})
export class GatesHttpModule {}
