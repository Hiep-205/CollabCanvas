import { Module } from '@nestjs/common';
import { AuthModule } from './modules/auth/auth.module';
import { CanvasModule } from './modules/canvas/canvas.module';
import { HealthController } from './modules/health/health.controller';
import { TasksModule } from './modules/tasks/tasks.module';
import { UsersModule } from './modules/users/users.module';
import { WorkspacesModule } from './modules/workspaces/workspaces.module';

@Module({
  imports: [AuthModule, UsersModule, WorkspacesModule, TasksModule, CanvasModule],
  controllers: [HealthController],
})
export class AppModule {}
