import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Put, Query, Req, UseGuards } from '@nestjs/common';
import { AuthenticatedRequest, SessionGuard } from '../auth/session.guard';
import { TasksService } from './tasks.service';

@Controller('workspaces/:workspaceId/tasks')
@UseGuards(SessionGuard)
export class TasksController {
  constructor(private readonly tasks: TasksService) {}

  @Post()
  create(
    @Req() request: AuthenticatedRequest,
    @Param('workspaceId', new ParseUUIDPipe({ version: '4' })) workspaceId: string,
    @Body() body: unknown,
  ) {
    return this.tasks.create(request.currentUser.id, workspaceId, body);
  }

  @Get()
  list(
    @Req() request: AuthenticatedRequest,
    @Param('workspaceId', new ParseUUIDPipe({ version: '4' })) workspaceId: string,
    @Query('status') status?: string,
    @Query('page') page?: string,
    @Query('query') query?: string,
    @Query('priority') priority?: string,
    @Query('due') due?: string,
    @Query('assigneeId') assigneeId?: string,
  ) {
    return this.tasks.list(request.currentUser.id, workspaceId, status, page, query, priority, due, assigneeId);
  }

  @Get(':taskId')
  findOne(
    @Req() request: AuthenticatedRequest,
    @Param('workspaceId', new ParseUUIDPipe({ version: '4' })) workspaceId: string,
    @Param('taskId', new ParseUUIDPipe({ version: '4' })) taskId: string,
  ) {
    return this.tasks.findOne(request.currentUser.id, workspaceId, taskId);
  }

  @Patch(':taskId')
  @HttpCode(200)
  update(
    @Req() request: AuthenticatedRequest,
    @Param('workspaceId', new ParseUUIDPipe({ version: '4' })) workspaceId: string,
    @Param('taskId', new ParseUUIDPipe({ version: '4' })) taskId: string,
    @Body() body: unknown,
  ) {
    return this.tasks.update(request.currentUser.id, workspaceId, taskId, body);
  }

  @Put(':taskId/assignees')
  replaceAssignees(
    @Req() request: AuthenticatedRequest,
    @Param('workspaceId', new ParseUUIDPipe({ version: '4' })) workspaceId: string,
    @Param('taskId', new ParseUUIDPipe({ version: '4' })) taskId: string,
    @Body() body: unknown,
  ) {
    return this.tasks.replaceAssignees(request.currentUser.id, workspaceId, taskId, body);
  }

  @Post(':taskId/checklist')
  addChecklistItem(@Req() request: AuthenticatedRequest, @Param('workspaceId', new ParseUUIDPipe({ version: '4' })) workspaceId: string, @Param('taskId', new ParseUUIDPipe({ version: '4' })) taskId: string, @Body() body: unknown) {
    return this.tasks.addChecklistItem(request.currentUser.id, workspaceId, taskId, body);
  }

  @Patch(':taskId/checklist/:itemId')
  updateChecklistItem(@Req() request: AuthenticatedRequest, @Param('workspaceId', new ParseUUIDPipe({ version: '4' })) workspaceId: string, @Param('taskId', new ParseUUIDPipe({ version: '4' })) taskId: string, @Param('itemId', new ParseUUIDPipe({ version: '4' })) itemId: string, @Body() body: unknown) {
    return this.tasks.updateChecklistItem(request.currentUser.id, workspaceId, taskId, itemId, body);
  }

  @Delete(':taskId/checklist/:itemId')
  removeChecklistItem(@Req() request: AuthenticatedRequest, @Param('workspaceId', new ParseUUIDPipe({ version: '4' })) workspaceId: string, @Param('taskId', new ParseUUIDPipe({ version: '4' })) taskId: string, @Param('itemId', new ParseUUIDPipe({ version: '4' })) itemId: string, @Body() body: unknown) {
    return this.tasks.removeChecklistItem(request.currentUser.id, workspaceId, taskId, itemId, body);
  }
}
