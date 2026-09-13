import {
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Res,
  StreamableFile,
} from '@nestjs/common';
import * as fs from 'fs';
import type { Response } from 'express';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import type { AuthContext } from '../../common/interfaces/auth-context.interface';
import { PERMISSIONS } from '../rbac/constants/permissions.constant';
import { BackupService } from './backup.service';

@Controller('backups')
@RequirePermissions(PERMISSIONS.BACKUP.MANAGE)
export class BackupController {
  constructor(private readonly service: BackupService) {}

  @Get()
  list() {
    return this.service.listAll();
  }

  @Post()
  create(@CurrentUser() user: AuthContext) {
    return this.service.create(user.sub);
  }

  @Get(':filename/download')
  download(
    @Param('filename') filename: string,
    @Res({ passthrough: true }) res: Response,
  ): StreamableFile {
    const filePath = this.service.getFilePath(filename);
    res.set({
      'Content-Type': 'application/octet-stream',
      'Content-Disposition': `attachment; filename="${filename}"`,
    });
    return new StreamableFile(fs.createReadStream(filePath));
  }

  @Delete(':filename')
  async remove(
    @CurrentUser() user: AuthContext,
    @Param('filename') filename: string,
  ) {
    await this.service.delete(filename, user.sub);
    return { deleted: true };
  }
}
