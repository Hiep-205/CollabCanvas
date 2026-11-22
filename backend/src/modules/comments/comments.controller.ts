import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AuthenticatedRequest, SessionGuard } from '../auth/session.guard';
import { CommentsService } from './comments.service';

@Controller('workspaces/:workspaceId')
@UseGuards(SessionGuard)
export class CommentsController {
  constructor(private readonly comments: CommentsService) {}

  @Get('tasks/:taskId/comments')
  list(
    @Req() request: AuthenticatedRequest,
    @Param('workspaceId', new ParseUUIDPipe({ version: '4' })) workspaceId: string,
    @Param('taskId', new ParseUUIDPipe({ version: '4' })) taskId: string,
  ) {
    return this.comments.list(request.currentUser.id, workspaceId, taskId);
  }

  @Post('tasks/:taskId/comments')
  create(
    @Req() request: AuthenticatedRequest,
    @Param('workspaceId', new ParseUUIDPipe({ version: '4' })) workspaceId: string,
    @Param('taskId', new ParseUUIDPipe({ version: '4' })) taskId: string,
    @Body() body: unknown,
  ) {
    return this.comments.create(request.currentUser.id, workspaceId, taskId, body);
  }

  @Patch('comments/:commentId')
  @HttpCode(200)
  update(
    @Req() request: AuthenticatedRequest,
    @Param('workspaceId', new ParseUUIDPipe({ version: '4' })) workspaceId: string,
    @Param('commentId', new ParseUUIDPipe({ version: '4' })) commentId: string,
    @Body() body: unknown,
  ) {
    return this.comments.update(request.currentUser.id, workspaceId, commentId, body);
  }

  @Delete('comments/:commentId')
  @HttpCode(200)
  delete(
    @Req() request: AuthenticatedRequest,
    @Param('workspaceId', new ParseUUIDPipe({ version: '4' })) workspaceId: string,
    @Param('commentId', new ParseUUIDPipe({ version: '4' })) commentId: string,
  ) {
    return this.comments.delete(request.currentUser.id, workspaceId, commentId);
  }
}

@Controller('me/mentions')
@UseGuards(SessionGuard)
export class MentionsController {
  constructor(private readonly comments: CommentsService) {}

  @Get()
  listMentions(
    @Req() request: AuthenticatedRequest,
    @Query('status') status?: string,
    @Query('page') page?: string,
  ) {
    return this.comments.listMentions(request.currentUser.id, status, page);
  }

  @Patch('read-all')
  @HttpCode(200)
  markAllRead(@Req() request: AuthenticatedRequest) {
    return this.comments.markAllMentionsRead(request.currentUser.id);
  }

  @Patch(':commentId/read')
  @HttpCode(200)
  markRead(
    @Req() request: AuthenticatedRequest,
    @Param('commentId', new ParseUUIDPipe({ version: '4' })) commentId: string,
  ) {
    return this.comments.markMentionRead(request.currentUser.id, commentId);
  }
}
