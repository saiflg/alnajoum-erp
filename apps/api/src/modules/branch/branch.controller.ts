import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { PERMISSIONS } from '../rbac/constants/permissions.constant';
import { BranchService } from './branch.service';
import { CreateBranchDto } from './dto/create-branch.dto';
import { UpdateBranchDto } from './dto/update-branch.dto';

@Controller('branches')
export class BranchController {
  constructor(private readonly branchService: BranchService) {}

  @Post()
  @RequirePermissions(PERMISSIONS.BRANCH.CREATE)
  create(@Body() dto: CreateBranchDto) {
    return this.branchService.create(dto);
  }

  @Get()
  @RequirePermissions(PERMISSIONS.BRANCH.READ)
  findAll(@Query('companyId') companyId?: string) {
    return this.branchService.findAll(companyId);
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.BRANCH.READ)
  findOne(@Param('id') id: string) {
    return this.branchService.findOne(id);
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.BRANCH.UPDATE)
  update(@Param('id') id: string, @Body() dto: UpdateBranchDto) {
    return this.branchService.update(id, dto);
  }

  @Delete(':id')
  @RequirePermissions(PERMISSIONS.BRANCH.DELETE)
  remove(@Param('id') id: string) {
    return this.branchService.remove(id);
  }
}
