import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query, Req, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { AuthenticatedRequest, SessionGuard } from '../auth/session.guard';
import { InvitationsService } from './invitations.service';

@Controller('workspaces/:workspaceId/invitations')
@UseGuards(SessionGuard)
export class WorkspaceInvitationsController {
  constructor(private readonly invitations: InvitationsService) {}

  @Post()
  @HttpCode(202)
  @Throttle({ default: { limit: 15, ttl: 60_000 } })
  create(
    @Req() request: AuthenticatedRequest,
    @Param('workspaceId', new ParseUUIDPipe({ version: '4' })) workspaceId: string,
    @Body() body: unknown,
  ) {
    return this.invitations.create(request.currentUser.id, workspaceId, body);
  }
}

@Controller('invitations')
@UseGuards(SessionGuard)
export class InvitationsController {
  constructor(private readonly invitations: InvitationsService) {}

  @Get()
  inbox(@Req() request: AuthenticatedRequest, @Query('page') page?: string) {
    return this.invitations.inbox(request.currentUser.id, page);
  }

  @Post(':id/accept')
  @HttpCode(200)
  accept(@Req() request: AuthenticatedRequest, @Param('id', new ParseUUIDPipe({ version: '4' })) id: string) {
    return this.invitations.respond(request.currentUser.id, id, true);
  }

  @Post(':id/decline')
  @HttpCode(200)
  decline(@Req() request: AuthenticatedRequest, @Param('id', new ParseUUIDPipe({ version: '4' })) id: string) {
    return this.invitations.respond(request.currentUser.id, id, false);
  }
}
