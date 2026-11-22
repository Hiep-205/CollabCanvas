import { Module } from '@nestjs/common';
import { PrismaModule } from '../../infra/prisma/prisma.module';
import { AuthModule } from '../auth/auth.module';
import { TrashController } from './trash.controller';
import { TrashService } from './trash.service';

@Module({ imports: [AuthModule, PrismaModule], controllers: [TrashController], providers: [TrashService] })
export class TrashModule {}
