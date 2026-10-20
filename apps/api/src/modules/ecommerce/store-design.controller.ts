import {
  type StoreAsset,
  type StoreDesignState,
  type StoreProduct,
  type Storefront,
  saveStoreDesignSchema,
  storeDesignVersionSchema,
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
  Query,
  Req,
  Res,
} from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { Public, RequirePermission } from '../../kernel/access/access.decorators.js';
import { CurrentMerchantActor } from '../../kernel/access/current-actor.js';
import type { MerchantActor } from '../../kernel/access/session-resolver.js';
import { AppError } from '../../kernel/errors/app-error.js';
import { ZodPipe } from '../../kernel/validation/zod.pipe.js';
import { readUpload, sendImage } from './ecommerce.controller.js';
import { EcommerceService } from './ecommerce.service.js';
import { StoreDesignService } from './store-design.service.js';

const uuid = new ParseUUIDPipe();
type O<T extends z.ZodType> = z.output<T>;
const branchQuery = z.object({
  branch: z
    .uuid()
    .optional()
    .transform((v) => v ?? null),
});

/** The console's store design (ADR-0128): draft, publish, discard, pictures and preview. */
@Controller('manager/online')
export class StoreDesignController {
  constructor(
    private readonly design: StoreDesignService,
    private readonly store: EcommerceService,
  ) {}

  @RequirePermission('manager', 'online.manage')
  @Get('design')
  state(@CurrentMerchantActor() actor: MerchantActor): Promise<StoreDesignState> {
    return this.design.state(actor);
  }

  @RequirePermission('manager', 'online.manage')
  @Put('design')
  save(
    @CurrentMerchantActor() actor: MerchantActor,
    @Body(new ZodPipe(saveStoreDesignSchema)) body: O<typeof saveStoreDesignSchema>,
    @Req() req: FastifyRequest,
  ): Promise<StoreDesignState> {
    return this.design.save(actor, body, req.ip);
  }

  @RequirePermission('manager', 'online.manage')
  @Post('design/publish')
  @HttpCode(200)
  publish(
    @CurrentMerchantActor() actor: MerchantActor,
    @Body(new ZodPipe(storeDesignVersionSchema)) body: O<typeof storeDesignVersionSchema>,
    @Req() req: FastifyRequest,
  ): Promise<StoreDesignState> {
    return this.design.publish(actor, body, req.ip);
  }

  @RequirePermission('manager', 'online.manage')
  @Post('design/discard')
  @HttpCode(200)
  discard(
    @CurrentMerchantActor() actor: MerchantActor,
    @Body(new ZodPipe(storeDesignVersionSchema)) body: O<typeof storeDesignVersionSchema>,
    @Req() req: FastifyRequest,
  ): Promise<StoreDesignState> {
    return this.design.discard(actor, body, req.ip);
  }

  @RequirePermission('manager', 'online.manage')
  @Get('design/assets')
  assets(@CurrentMerchantActor() actor: MerchantActor): Promise<{ assets: StoreAsset[] }> {
    return this.design.assets(actor);
  }

  @RequirePermission('manager', 'online.manage')
  @Post('design/assets')
  async upload(
    @CurrentMerchantActor() actor: MerchantActor,
    @Req() req: FastifyRequest,
  ): Promise<StoreAsset> {
    return this.design.upload(actor, await readUpload(req), req.ip);
  }

  @RequirePermission('manager', 'online.manage')
  @Delete('design/assets/:id')
  removeAsset(
    @CurrentMerchantActor() actor: MerchantActor,
    @Param('id', uuid) id: string,
    @Req() req: FastifyRequest,
  ): Promise<{ assets: StoreAsset[] }> {
    return this.design.removeAsset(actor, id, req.ip);
  }

  @RequirePermission('manager', 'online.manage')
  @Get('design/assets/:id/file')
  async assetFile(
    @CurrentMerchantActor() actor: MerchantActor,
    @Param('id', uuid) id: string,
    @Res() reply: FastifyReply,
  ) {
    await sendImage(reply, await this.design.assetFile(actor, id), 'private, max-age=3600');
  }

  // The store as shoppers would see it, also while it is a draft: the console's preview.
  @RequirePermission('manager', 'online.manage')
  @Get('preview/storefront')
  previewStorefront(@CurrentMerchantActor() actor: MerchantActor): Promise<Storefront> {
    return this.store.previewStorefront(actor);
  }

  @RequirePermission('manager', 'online.manage')
  @Get('preview/products')
  previewProducts(
    @CurrentMerchantActor() actor: MerchantActor,
    @Query(new ZodPipe(branchQuery)) query: O<typeof branchQuery>,
  ): Promise<{ products: StoreProduct[] }> {
    return this.store.previewProducts(actor, query.branch);
  }

  @RequirePermission('manager', 'online.manage')
  @Get('preview/products/:id')
  async previewProduct(
    @CurrentMerchantActor() actor: MerchantActor,
    @Param('id', uuid) id: string,
    @Query(new ZodPipe(branchQuery)) query: O<typeof branchQuery>,
  ): Promise<StoreProduct> {
    const [p] = (await this.store.previewProducts(actor, query.branch, id)).products;
    if (!p) throw AppError.notFound('Product not found.');
    return p;
  }
}

/** The published design and its pictures, for shoppers (ADR-0128). */
@Controller('store/:slug')
export class StoreDesignPublicController {
  constructor(private readonly design: StoreDesignService) {}

  @Public()
  @Get('design')
  publicDesign(@Param('slug') slug: string) {
    return this.design.publicDesign(slug);
  }

  @Public()
  @Get('assets/:id')
  async asset(
    @Param('slug') slug: string,
    @Param('id', uuid) id: string,
    @Res() reply: FastifyReply,
  ) {
    // A picture never changes under its id: cache it for a year.
    await sendImage(
      reply,
      await this.design.publicAsset(slug, id),
      'public, max-age=31536000, immutable',
    );
  }
}
