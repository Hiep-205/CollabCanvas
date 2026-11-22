import { Module } from '@nestjs/common';
import { PrismaModule } from '../../infra/prisma/prisma.module';
import { AuthModule } from '../auth/auth.module';
import { CommentsController, MentionsController } from './comments.controller';
import { CommentsService } from './comments.service';

@Module({
  imports: [AuthModule, PrismaModule],
  controllers: [CommentsController, MentionsController],
  providers: [CommentsService],
  exports: [CommentsService],
})
export class CommentsModule {}
