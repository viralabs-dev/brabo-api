import { Module } from '@nestjs/common';
import { ProposeActionUseCase } from './propose-action.use-case';
import { ApproveActionUseCase } from './approve-action.use-case';
import { RejectActionUseCase } from './reject-action.use-case';
import { ListProposedActionsUseCase } from './list-proposed-actions.use-case';

const USE_CASES = [
  ProposeActionUseCase,
  ApproveActionUseCase,
  RejectActionUseCase,
  ListProposedActionsUseCase,
];

@Module({
  providers: USE_CASES,
  exports: USE_CASES,
})
export class ActionsUseCasesModule {}
