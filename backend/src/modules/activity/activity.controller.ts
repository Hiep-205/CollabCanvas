import { Controller, Get, Param, ParseUUIDPipe, Query, Req, UseGuards } from '@nestjs/common';
import { AuthenticatedRequest, SessionGuard } from '../auth/session.guard';
import { ActivityService } from './activity.service';

@Controller('workspaces/:workspaceId/activity')
@UseGuards(SessionGuard)
export class ActivityController {
  constructor(private readonly activity: ActivityService) {}

  @Get()
  list(
    @Req() request: AuthenticatedRequest,
    @Param('workspaceId', new ParseUUIDPipe({ version: '4' })) workspaceId: string,
    @Query('page') page?: string,
    @Query('taskId') taskId?: string,
  ) {
    return this.activity.list(request.currentUser.id, workspaceId, page, taskId);
  }
}
