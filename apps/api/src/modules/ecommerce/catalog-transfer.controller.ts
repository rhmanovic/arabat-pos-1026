import { TRANSFER_KINDS, type TransferKind, type TransferResult } from '@arabat/contracts';
import { Controller, Get, Param, Post, Query, Req, Res } from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { RequirePermission } from '../../kernel/access/access.decorators.js';
import { CurrentMerchantActor } from '../../kernel/access/current-actor.js';
import type { MerchantActor } from '../../kernel/access/session-resolver.js';
import { AppError } from '../../kernel/errors/app-error.js';
import { ZodPipe } from '../../kernel/validation/zod.pipe.js';
import { CatalogTransferService } from './catalog-transfer.service.js';

/** Excel files of at most 2 MB (about 2,000 rows easily fit). */
const MAX_SHEET_BYTES = 2 * 1024 * 1024;
const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const kindPipe = new ZodPipe(z.enum(TRANSFER_KINDS));
const applyPipe = new ZodPipe(z.enum(['true', 'false']).optional());

/** Products and categories in Excel from the store console (ADR-0132). */
@Controller('manager/online/transfer')
export class CatalogTransferController {
  constructor(private readonly transfer: CatalogTransferService) {}

  @RequirePermission('manager', 'online.manage')
  @Get(':kind/template')
  async template(
    @CurrentMerchantActor() actor: MerchantActor,
    @Param('kind', kindPipe) kind: TransferKind,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    await this.send(reply, `${kind}-template`, await this.transfer.workbook(actor, kind, false));
  }

  @RequirePermission('manager', 'online.manage')
  @Get(':kind/export')
  async export(
    @CurrentMerchantActor() actor: MerchantActor,
    @Param('kind', kindPipe) kind: TransferKind,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    const stamp = new Date().toISOString().slice(0, 10);
    await this.send(reply, `${kind}-${stamp}`, await this.transfer.workbook(actor, kind, true));
  }

  /** `apply=false` (default) checks the file only; `apply=true` writes it in one transaction. */
  @RequirePermission('manager', 'online.manage')
  @Post(':kind/import')
  async import(
    @CurrentMerchantActor() actor: MerchantActor,
    @Param('kind', kindPipe) kind: TransferKind,
    @Query('apply', applyPipe) apply: 'true' | 'false' | undefined,
    @Req() req: FastifyRequest,
  ): Promise<TransferResult> {
    if (!req.isMultipart())
      throw new AppError(415, 'UNSUPPORTED_MEDIA', 'Send the Excel file as multipart/form-data.');
    const file = await req.file({ limits: { fileSize: MAX_SHEET_BYTES + 1, files: 1 } });
    if (!file)
      throw AppError.validation([
        { path: 'file', code: 'required', message: 'An Excel file is required.' },
      ]);
    const data = await file.toBuffer().catch(() => {
      throw new AppError(413, 'PAYLOAD_TOO_LARGE', 'Excel files must be at most 2 MB.');
    });
    if (file.file.truncated)
      throw new AppError(413, 'PAYLOAD_TOO_LARGE', 'Excel files must be at most 2 MB.');
    return this.transfer.import(actor, kind, data, apply === 'true', req.ip);
  }

  private async send(reply: FastifyReply, name: string, data: Buffer) {
    await reply
      .header('content-type', XLSX)
      .header('content-disposition', `attachment; filename="${name}.xlsx"`)
      .header('cache-control', 'private, no-store')
      .header('x-content-type-options', 'nosniff')
      .send(data);
  }
}
