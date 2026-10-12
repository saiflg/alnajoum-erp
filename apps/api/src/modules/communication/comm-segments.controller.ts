import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import type { AuthContext } from '../../common/interfaces/auth-context.interface';
import { PERMISSIONS } from '../rbac/constants/permissions.constant';
import { CommSegmentsService } from './comm-segments.service';
import {
  CreateSegmentDto,
  PreviewSegmentDto,
  SegmentMembersDto,
  UpdateSegmentDto,
} from './dto/comm-segment.dto';

function companyOf(user: AuthContext): string {
  if (!user.companyId)
    throw new BadRequestException('Your account is not attached to a company.');
  return user.companyId;
}

@Controller('comm/segments')
export class CommSegmentsController {
  constructor(private readonly segments: CommSegmentsService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.COMM.CONTACT_READ)
  list(@CurrentUser() user: AuthContext, @Query('counts') counts?: string) {
    return this.segments.list(companyOf(user), counts === 'true');
  }

  @Post('preview')
  @RequirePermissions(PERMISSIONS.COMM.CONTACT_READ)
  preview(@CurrentUser() user: AuthContext, @Body() dto: PreviewSegmentDto) {
    return this.segments.preview(
      companyOf(user),
      dto.definition,
      dto.channel,
      dto.topic,
    );
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.COMM.CONTACT_READ)
  get(@CurrentUser() user: AuthContext, @Param('id') id: string) {
    return this.segments.get(companyOf(user), id);
  }

  /** Who is in the segment and who of them may be messaged on a channel and topic. */
  @Get(':id/audience')
  @RequirePermissions(PERMISSIONS.COMM.CONTACT_READ)
  audience(
    @CurrentUser() user: AuthContext,
    @Param('id') id: string,
    @Query('channel') channel: string,
    @Query('topic') topic?: string,
  ) {
    if (channel !== 'WHATSAPP' && channel !== 'EMAIL')
      throw new BadRequestException('channel must be WHATSAPP or EMAIL');
    return this.segments.audienceFor(
      companyOf(user),
      id,
      channel,
      topic || 'general',
    );
  }

  @Post()
  @RequirePermissions(PERMISSIONS.COMM.SEGMENT_MANAGE)
  create(@CurrentUser() user: AuthContext, @Body() dto: CreateSegmentDto) {
    return this.segments.create(companyOf(user), dto, user.sub);
  }

  @Put(':id')
  @RequirePermissions(PERMISSIONS.COMM.SEGMENT_MANAGE)
  update(
    @CurrentUser() user: AuthContext,
    @Param('id') id: string,
    @Body() dto: UpdateSegmentDto,
  ) {
    return this.segments.update(companyOf(user), id, dto, user.sub);
  }

  @Delete(':id')
  @RequirePermissions(PERMISSIONS.COMM.SEGMENT_MANAGE)
  remove(@CurrentUser() user: AuthContext, @Param('id') id: string) {
    return this.segments.remove(companyOf(user), id, user.sub);
  }

  @Post(':id/members')
  @RequirePermissions(PERMISSIONS.COMM.SEGMENT_MANAGE)
  addMembers(
    @CurrentUser() user: AuthContext,
    @Param('id') id: string,
    @Body() dto: SegmentMembersDto,
  ) {
    return this.segments.addMembers(
      companyOf(user),
      id,
      dto.contactIds,
      user.sub,
    );
  }

  @Post(':id/members/remove')
  @RequirePermissions(PERMISSIONS.COMM.SEGMENT_MANAGE)
  removeMembers(
    @CurrentUser() user: AuthContext,
    @Param('id') id: string,
    @Body() dto: SegmentMembersDto,
  ) {
    return this.segments.removeMembers(
      companyOf(user),
      id,
      dto.contactIds,
      user.sub,
    );
  }
}
