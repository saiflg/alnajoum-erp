import {
  Controller,
  Get,
  Param,
  ParseEnumPipe,
  Res,
  StreamableFile,
} from '@nestjs/common';
import { PilgrimType } from '@prisma/client';
import type { Response } from 'express';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { PERMISSIONS } from '../rbac/constants/permissions.constant';
import { ManifestService } from './manifest.service';

/** Spec #17/#18/#20 — contains passport numbers, so every route here is gated behind MANIFEST_VIEW. */
@Controller('hajj-ops/manifests')
export class ManifestController {
  constructor(private readonly service: ManifestService) {}

  @Get(':type/:groupId/pdf')
  @RequirePermissions(PERMISSIONS.HAJJ_OPS.MANIFEST_VIEW)
  async pdf(
    @Param('type', new ParseEnumPipe(PilgrimType)) type: PilgrimType,
    @Param('groupId') groupId: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const { stream, filename } = await this.service.renderPdf(type, groupId);
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${filename}"`,
    });
    return new StreamableFile(stream);
  }

  @Get(':type/:groupId/csv')
  @RequirePermissions(PERMISSIONS.HAJJ_OPS.MANIFEST_VIEW)
  async csv(
    @Param('type', new ParseEnumPipe(PilgrimType)) type: PilgrimType,
    @Param('groupId') groupId: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const { content, filename } = await this.service.renderCsv(type, groupId);
    res.set({
      'Content-Type': 'text/csv',
      'Content-Disposition': `attachment; filename="${filename}"`,
    });
    return new StreamableFile(Buffer.from(content, 'utf-8'));
  }
}
