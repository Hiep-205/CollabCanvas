import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { AuthenticatedRequest, SessionGuard } from '../auth/session.guard';
import { WorkspacesService } from './workspaces.service';

@Controller('workspaces')
@UseGuards(SessionGuard)
export class WorkspacesController {
  constructor(private readonly workspaces: WorkspacesService) {}

  @Post()
  create(@Req() request: AuthenticatedRequest, @Body() body: unknown) {
    return this.workspaces.create(request.currentUser.id, body);
  }

  @Get()
  list(@Req() request: AuthenticatedRequest, @Query('page') page?: string) {
    return this.workspaces.list(request.currentUser.id, page);
  }

  @Get(':id')
  findOne(@Req() request: AuthenticatedRequest, @Param('id', new ParseUUIDPipe({ version: '4' })) id: string) {
    return this.workspaces.findOne(request.currentUser.id, id);
  }

  @Get(':id/members')
  listMembers(@Req() request: AuthenticatedRequest, @Param('id', new ParseUUIDPipe({ version: '4' })) id: string, @Query('page') page?: string) {
    return this.workspaces.listMembers(request.currentUser.id, id, page);
  }

  @Patch(':id/members/:memberId')
  changeMemberRole(
    @Req() request: AuthenticatedRequest,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Param('memberId', new ParseUUIDPipe({ version: '4' })) memberId: string,
    @Body() body: unknown,
  ) {
    return this.workspaces.changeMemberRole(request.currentUser.id, id, memberId, body);
  }

  @Delete(':id/members/:memberId')
  removeMember(
    @Req() request: AuthenticatedRequest,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Param('memberId', new ParseUUIDPipe({ version: '4' })) memberId: string,
  ) {
    return this.workspaces.removeMember(request.currentUser.id, id, memberId);
  }

  @Patch(':id')
  update(
    @Req() request: AuthenticatedRequest,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() body: unknown,
  ) {
    return this.workspaces.update(request.currentUser.id, id, body);
  }

  @Delete(':id/leave')
  leave(
    @Req() request: AuthenticatedRequest,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
  ) {
    return this.workspaces.leave(request.currentUser.id, id);
  }

  @Delete(':id')
  remove(
    @Req() request: AuthenticatedRequest,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
  ) {
    return this.workspaces.remove(request.currentUser.id, id);
  }
}
