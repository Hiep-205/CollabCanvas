import { Body, Controller, Get, Param, ParseUUIDPipe, Put, Req, UseGuards } from '@nestjs/common';
import { AuthenticatedRequest, SessionGuard } from '../auth/session.guard';
import { CanvasService } from './canvas.service';

@Controller('workspaces/:workspaceId/canvas')
@UseGuards(SessionGuard)
export class CanvasController {
  constructor(private readonly canvas: CanvasService) {}

  @Get()
  get(@Req() request: AuthenticatedRequest, @Param('workspaceId', new ParseUUIDPipe({ version: '4' })) workspaceId: string) {
    return this.canvas.get(request.currentUser.id, workspaceId);
  }

  @Put()
  save(@Req() request: AuthenticatedRequest, @Param('workspaceId', new ParseUUIDPipe({ version: '4' })) workspaceId: string, @Body() body: unknown) {
    return this.canvas.save(request.currentUser.id, workspaceId, body);
  }
}
