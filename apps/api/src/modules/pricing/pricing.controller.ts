import {
  type OfferItem,
  type PublicOffer,
  type SalesRequest,
  type SalesRequestCreated,
  type SalesRequestList,
  createSalesRequestSchema,
  salesRequestQuerySchema,
  saveOfferItemSchema,
  updateSalesRequestSchema,
} from '@arabat/contracts';
import type { PlatformRole } from '@arabat/permissions';
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
  Query,
  Req,
  Res,
} from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { z } from 'zod';
import { Public, RequirePlatformRole } from '../../kernel/access/access.decorators.js';
import { CurrentPlatformActor } from '../../kernel/access/current-actor.js';
import type { PlatformActor } from '../../kernel/access/session-resolver.js';
import { AppError } from '../../kernel/errors/app-error.js';
import { ZodPipe } from '../../kernel/validation/zod.pipe.js';
import { RateLimiterService } from '../auth/rate-limiter.service.js';
import { MAX_OFFER_IMAGE_BYTES, PricingService } from './pricing.service.js';

const uuid = new ParseUUIDPipe();
type O<T extends z.ZodType> = z.output<T>;
/** Purchase requests per IP: enough for a shop, not for a script (ADR-0114). */
const REQUEST_LIMIT = { limit: 5, windowSeconds: 3600 };

/** Public pricing page (`/pricing` on the landing site). No session. */
@Controller('public/pricing')
export class PublicPricingController {
  constructor(
    private readonly pricing: PricingService,
    private readonly limiter: RateLimiterService,
  ) {}

  @Public()
  @Get()
  offer(): Promise<PublicOffer> {
    return this.pricing.publicOffer();
  }

  @Public()
  @Get('images/:id')
  async image(@Param('id', uuid) id: string, @Res() reply: FastifyReply) {
    const { data, contentType } = await this.pricing.image(id);
    await reply
      .header('content-type', contentType)
      .header('cache-control', 'public, max-age=86400')
      .header('x-content-type-options', 'nosniff')
      .header('content-security-policy', "default-src 'none'")
      .send(data);
  }

  @Public()
  @Post('requests')
  async request(
    @Body(new ZodPipe(createSalesRequestSchema)) body: O<typeof createSalesRequestSchema>,
    @Req() req: FastifyRequest,
  ): Promise<SalesRequestCreated> {
    await this.limiter.consume(`pricing-request:${req.ip}`, REQUEST_LIMIT);
    return this.pricing.createRequest(body, req.ip);
  }
}

const ANY: PlatformRole[] = ['platform.super_admin', 'platform.support', 'platform.billing'];
const BILLING: PlatformRole[] = ['platform.super_admin', 'platform.billing'];

/** The operator manages the offer and follows up the requests (AUTH.md §8). */
@Controller('platform')
export class PlatformPricingController {
  constructor(private readonly pricing: PricingService) {}

  @RequirePlatformRole(...ANY)
  @Get('offer-items')
  async items(): Promise<{ items: OfferItem[] }> {
    return { items: await this.pricing.items() };
  }

  @RequirePlatformRole(...BILLING)
  @Post('offer-items')
  createItem(
    @CurrentPlatformActor() actor: PlatformActor,
    @Body(new ZodPipe(saveOfferItemSchema)) body: O<typeof saveOfferItemSchema>,
    @Req() req: FastifyRequest,
  ): Promise<OfferItem> {
    return this.pricing.saveItem(actor, null, body, req.ip);
  }

  @RequirePlatformRole(...BILLING)
  @Put('offer-items/:id')
  updateItem(
    @CurrentPlatformActor() actor: PlatformActor,
    @Param('id', uuid) id: string,
    @Body(new ZodPipe(saveOfferItemSchema)) body: O<typeof saveOfferItemSchema>,
    @Req() req: FastifyRequest,
  ): Promise<OfferItem> {
    return this.pricing.saveItem(actor, id, body, req.ip);
  }

  /** multipart/form-data with one `file` field; the content type is detected from the bytes. */
  @RequirePlatformRole(...BILLING)
  @Post('offer-items/:id/image')
  @HttpCode(200)
  async uploadImage(
    @CurrentPlatformActor() actor: PlatformActor,
    @Param('id', uuid) id: string,
    @Req() req: FastifyRequest,
  ): Promise<OfferItem> {
    if (!req.isMultipart())
      throw new AppError(415, 'UNSUPPORTED_MEDIA', 'Send the image as multipart/form-data.');
    const file = await req.file({ limits: { fileSize: MAX_OFFER_IMAGE_BYTES + 1, files: 1 } });
    if (!file)
      throw AppError.validation([
        { path: 'file', code: 'required', message: 'An image file is required.' },
      ]);
    const data = await file.toBuffer().catch(() => {
      throw new AppError(413, 'PAYLOAD_TOO_LARGE', 'Images must be at most 2 MB.');
    });
    if (file.file.truncated)
      throw new AppError(413, 'PAYLOAD_TOO_LARGE', 'Images must be at most 2 MB.');
    return this.pricing.setImage(actor, id, data, req.ip);
  }

  @RequirePlatformRole(...BILLING)
  @Delete('offer-items/:id/image')
  removeImage(
    @CurrentPlatformActor() actor: PlatformActor,
    @Param('id', uuid) id: string,
    @Req() req: FastifyRequest,
  ): Promise<OfferItem> {
    return this.pricing.setImage(actor, id, null, req.ip);
  }

  @RequirePlatformRole(...ANY)
  @Get('sales-requests')
  requests(
    @Query(new ZodPipe(salesRequestQuerySchema)) q: O<typeof salesRequestQuerySchema>,
  ): Promise<SalesRequestList> {
    return this.pricing.requests(q.status);
  }

  @RequirePlatformRole(...ANY)
  @Get('sales-requests/:id')
  request(@Param('id', uuid) id: string): Promise<SalesRequest> {
    return this.pricing.request(id);
  }

  @RequirePlatformRole(...ANY)
  @Put('sales-requests/:id')
  updateRequest(
    @CurrentPlatformActor() actor: PlatformActor,
    @Param('id', uuid) id: string,
    @Body(new ZodPipe(updateSalesRequestSchema)) body: O<typeof updateSalesRequestSchema>,
    @Req() req: FastifyRequest,
  ): Promise<SalesRequest> {
    return this.pricing.updateRequest(actor, id, body, req.ip);
  }
}
