import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { PERMISSIONS } from '../rbac/constants/permissions.constant';
import { CompanyService } from './company.service';
import { CreateCompanyDto } from './dto/create-company.dto';
import { UpdateCompanyDto } from './dto/update-company.dto';

@Controller('companies')
export class CompanyController {
  constructor(private readonly companyService: CompanyService) {}

  @Post()
  @RequirePermissions(PERMISSIONS.COMPANY.CREATE)
  create(@Body() dto: CreateCompanyDto) {
    return this.companyService.create(dto);
  }

  @Get()
  @RequirePermissions(PERMISSIONS.COMPANY.READ)
  findAll() {
    return this.companyService.findAll();
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.COMPANY.READ)
  findOne(@Param('id') id: string) {
    return this.companyService.findOne(id);
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.COMPANY.UPDATE)
  update(@Param('id') id: string, @Body() dto: UpdateCompanyDto) {
    return this.companyService.update(id, dto);
  }

  @Delete(':id')
  @RequirePermissions(PERMISSIONS.COMPANY.DELETE)
  remove(@Param('id') id: string) {
    return this.companyService.remove(id);
  }
}
