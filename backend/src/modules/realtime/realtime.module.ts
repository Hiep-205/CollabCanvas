import { Global, Module } from '@nestjs/common';
import { PrismaModule } from '../../infra/prisma/prisma.module';
import { AuthModule } from '../auth/auth.module';
import { PresenceService } from './presence.service';
import { WorkspaceGateway } from './workspace.gateway';

@Global()
@Module({
  imports: [AuthModule, PrismaModule],
  providers: [WorkspaceGateway, PresenceService],
  exports: [WorkspaceGateway, PresenceService],
})
export class RealtimeModule {}
