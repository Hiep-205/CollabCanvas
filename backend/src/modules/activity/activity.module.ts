import { Module } from '@nestjs/common';
import { PrismaModule } from '../../infra/prisma/prisma.module';
import { AuthModule } from '../auth/auth.module';
import { ActivityController } from './activity.controller';
import { ActivityService } from './activity.service';

@Module({ imports: [AuthModule, PrismaModule], controllers: [ActivityController], providers: [ActivityService] })
export class ActivityModule {}
