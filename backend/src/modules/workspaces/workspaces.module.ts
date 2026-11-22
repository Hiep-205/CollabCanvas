import { Module } from '@nestjs/common';
import { PrismaModule } from '../../infra/prisma/prisma.module';
import { RealtimeModule } from '../realtime/realtime.module';
import { AuthModule } from '../auth/auth.module';
import { InvitationsController, WorkspaceInvitationsController } from './invitations.controller';
import { InvitationsService } from './invitations.service';
import { WorkspacesController } from './workspaces.controller';
import { WorkspacesService } from './workspaces.service';

@Module({
  imports: [AuthModule, PrismaModule, RealtimeModule],
  controllers: [WorkspacesController, WorkspaceInvitationsController, InvitationsController],
  providers: [WorkspacesService, InvitationsService],
})
export class WorkspacesModule {}
