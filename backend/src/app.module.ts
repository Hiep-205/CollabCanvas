import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { ActivityModule } from './modules/activity/activity.module';
import { AuthModule } from './modules/auth/auth.module';
import { CommentsModule } from './modules/comments/comments.module';
import { DashboardModule } from './modules/dashboard/dashboard.module';
import { CanvasModule } from './modules/canvas/canvas.module';
import { HealthController } from './modules/health/health.controller';
import { RealtimeModule } from './modules/realtime/realtime.module';
import { TasksModule } from './modules/tasks/tasks.module';
import { TrashModule } from './modules/trash/trash.module';
import { UsersModule } from './modules/users/users.module';
import { WorkspacesModule } from './modules/workspaces/workspaces.module';

@Module({
  imports: [
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 60 }]),
    RealtimeModule,
    AuthModule, UsersModule, WorkspacesModule, TasksModule, CommentsModule, CanvasModule, TrashModule, ActivityModule, DashboardModule,
  ],
  controllers: [HealthController],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
