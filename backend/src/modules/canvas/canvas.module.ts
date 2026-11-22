import { Module } from '@nestjs/common';
import { PrismaModule } from '../../infra/prisma/prisma.module';
import { AuthModule } from '../auth/auth.module';
import { CanvasController } from './canvas.controller';
import { CanvasService } from './canvas.service';

@Module({ imports: [AuthModule, PrismaModule], controllers: [CanvasController], providers: [CanvasService] })
export class CanvasModule {}
