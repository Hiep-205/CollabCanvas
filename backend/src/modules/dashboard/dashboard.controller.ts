import { Controller, Get, Query, Req, UseGuards } from '@nestjs/common';
import { AuthenticatedRequest, SessionGuard } from '../auth/session.guard';
import { DashboardService } from './dashboard.service';

@Controller('dashboard')
@UseGuards(SessionGuard)
export class DashboardController {
  constructor(private readonly dashboard: DashboardService) {}

  @Get()
  overview(@Req() request: AuthenticatedRequest, @Query('page') page?: string) {
    return this.dashboard.overview(request.currentUser.id, page);
  }
}
