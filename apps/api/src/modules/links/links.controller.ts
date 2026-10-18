import {
  type LinkPage,
  MAX_LINK_AVATAR_BYTES,
  type PublicLinkPage,
  reorderLinkItemsSchema,
  saveLinkItemSchema,
  saveLinkPageSchema,
} from '@arabat/contracts';
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Req,
  Res,
} from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { z } from 'zod';
import { Public, RequirePermission } from '../../kernel/access/access.decorators.js';
import { CurrentMerchantActor } from '../../kernel/access/current-actor.js';
import type { MerchantActor } from '../../kernel/access/session-resolver.js';
import { AppError } from '../../kernel/errors/app-error.js';
import { ZodPipe } from '../../kernel/validation/zod.pipe.js';
import { RateLimiterService } from '../auth/rate-limiter.service.js';
import { LinksService } from './links.service.js';

const uuid = new ParseUUIDPipe();
type O<T extends z.ZodType> = z.output<T>;
/** Link opens counted per visitor and page: enough for people, not for a script (BR-201). */
const CLICK_LIMIT = { limit: 60, windowSeconds: 600 };

const sendImage = (reply: FastifyReply, image: { data: Buffer; contentType: string }) =>
  reply
    .header('content-type', image.contentType)
    .header('cache-control', 'public, max-age=86400')
    .header('x-content-type-options', 'nosniff')
    .header('content-security-policy', "default-src 'none'")
    .send(image.data);

@Controller('manager/link-page')
export class LinkPageManagerController {
  constructor(private readonly links: LinksService) {}

  @RequirePermission('manager', 'online.manage')
  @Get()
  get(@CurrentMerchantActor() actor: MerchantActor): Promise<LinkPage> {
    return this.links.page(actor);
  }

  @RequirePermission('manager', 'online.manage')
  @Put()
  save(
    @CurrentMerchantActor() actor: MerchantActor,
    @Body(new ZodPipe(saveLinkPageSchema)) body: O<typeof saveLinkPageSchema>,
    @Req() req: FastifyRequest,
  ): Promise<LinkPage> {
    return this.links.savePage(actor, body, req.ip);
  }

  @RequirePermission('manager', 'online.manage')
  @Post('items')
  create(
    @CurrentMerchantActor() actor: MerchantActor,
    @Body(new ZodPipe(saveLinkItemSchema)) body: O<typeof saveLinkItemSchema>,
    @Req() req: FastifyRequest,
  ): Promise<LinkPage> {
    return this.links.createItem(actor, body, req.ip);
  }

  @RequirePermission('manager', 'online.manage')
  @Put('items/order')
  reorder(
    @CurrentMerchantActor() actor: MerchantActor,
    @Body(new ZodPipe(reorderLinkItemsSchema)) body: O<typeof reorderLinkItemsSchema>,
    @Req() req: FastifyRequest,
  ): Promise<LinkPage> {
    return this.links.reorder(actor, body.ids, req.ip);
  }

  @RequirePermission('manager', 'online.manage')
  @Put('items/:id')
  update(
    @CurrentMerchantActor() actor: MerchantActor,
    @Param('id', uuid) id: string,
    @Body(new ZodPipe(saveLinkItemSchema)) body: O<typeof saveLinkItemSchema>,
    @Req() req: FastifyRequest,
  ): Promise<LinkPage> {
    return this.links.updateItem(actor, id, body, req.ip);
  }

  @RequirePermission('manager', 'online.manage')
  @Delete('items/:id')
  remove(
    @CurrentMerchantActor() actor: MerchantActor,
    @Param('id', uuid) id: string,
    @Req() req: FastifyRequest,
  ): Promise<LinkPage> {
    return this.links.deleteItem(actor, id, req.ip);
  }

  @RequirePermission('manager', 'online.manage')
  @Get('avatar')
  async avatar(@CurrentMerchantActor() actor: MerchantActor, @Res() reply: FastifyReply) {
    await sendImage(reply, await this.links.avatar(actor));
  }

  /** multipart/form-data with one `file` field; the content type is detected from the bytes. */
  @RequirePermission('manager', 'online.manage')
  @Post('avatar')
  @HttpCode(200)
  async uploadAvatar(
    @CurrentMerchantActor() actor: MerchantActor,
    @Req() req: FastifyRequest,
  ): Promise<LinkPage> {
    if (!req.isMultipart())
      throw new AppError(415, 'UNSUPPORTED_MEDIA', 'Send the image as multipart/form-data.');
    const file = await req.file({ limits: { fileSize: MAX_LINK_AVATAR_BYTES + 1, files: 1 } });
    if (!file)
      throw AppError.validation([
        { path: 'file', code: 'required', message: 'An image file is required.' },
      ]);
    const data = await file.toBuffer().catch(() => {
      throw new AppError(413, 'PAYLOAD_TOO_LARGE', 'Images must be at most 2 MB.');
    });
    if (file.file.truncated)
      throw new AppError(413, 'PAYLOAD_TOO_LARGE', 'Images must be at most 2 MB.');
    return this.links.setAvatar(actor, data, req.ip);
  }

  @RequirePermission('manager', 'online.manage')
  @Delete('avatar')
  removeAvatar(
    @CurrentMerchantActor() actor: MerchantActor,
    @Req() req: FastifyRequest,
  ): Promise<LinkPage> {
    return this.links.setAvatar(actor, null, req.ip);
  }
}

/** Public link page: resolved by its address, never by a client-supplied merchant id. */
@Controller('public/links/:slug')
export class PublicLinksController {
  constructor(
    private readonly links: LinksService,
    private readonly limiter: RateLimiterService,
  ) {}

  @Public()
  @Get()
  page(@Param('slug') slug: string): Promise<PublicLinkPage> {
    return this.links.publicPage(slug);
  }

  @Public()
  @Get('avatar')
  async avatar(@Param('slug') slug: string, @Res() reply: FastifyReply) {
    await sendImage(reply, await this.links.publicAvatar(slug));
  }

  @Public()
  @Post('items/:id/click')
  @HttpCode(204)
  async click(
    @Param('slug') slug: string,
    @Param('id', uuid) id: string,
    @Req() req: FastifyRequest,
  ): Promise<void> {
    await this.limiter.consume(`link-click:${req.ip}:${slug.toLowerCase()}`, CLICK_LIMIT);
    await this.links.click(slug, id);
  }
}
