import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Query, Req, UseGuards } from '@nestjs/common';
import { AuthenticatedRequest, SessionGuard } from '../auth/session.guard';
import { TrashService } from './trash.service';

@Controller('workspaces/:workspaceId/trash')
@UseGuards(SessionGuard)
export class TrashController {
  constructor(private readonly trash: TrashService) {}

  @Get()
  list(@Req() request: AuthenticatedRequest, @Param('workspaceId', new ParseUUIDPipe({ version: '4' })) workspaceId: string,
    @Query('type') type: string, @Query('page') page?: string) {
    return this.trash.list(request.currentUser.id, workspaceId, type, page);
  }

  @Patch('tasks/:taskId')
  changeTask(@Req() request: AuthenticatedRequest, @Param('workspaceId', new ParseUUIDPipe({ version: '4' })) workspaceId: string,
    @Param('taskId', new ParseUUIDPipe({ version: '4' })) taskId: string, @Body() body: unknown) {
    return this.trash.changeTask(request.currentUser.id, workspaceId, taskId, body);
  }

  @Patch('notes/:noteId')
  changeNote(@Req() request: AuthenticatedRequest, @Param('workspaceId', new ParseUUIDPipe({ version: '4' })) workspaceId: string,
    @Param('noteId', new ParseUUIDPipe({ version: '4' })) noteId: string, @Body() body: unknown) {
    return this.trash.changeNote(request.currentUser.id, workspaceId, noteId, body);
  }
}
