import {
  type Category,
  type PosCatalog,
  type Product,
  productListQuerySchema,
  productStatusSchema,
  saveCategorySchema,
  saveProductSchema,
} from '@arabat/contracts';
import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { z } from 'zod';
import { RequirePermission } from '../../kernel/access/access.decorators.js';
import { CurrentMerchantActor } from '../../kernel/access/current-actor.js';
import type { MerchantActor } from '../../kernel/access/session-resolver.js';
import { AppError } from '../../kernel/errors/app-error.js';
import { ZodPipe } from '../../kernel/validation/zod.pipe.js';
import { CatalogService, MAX_IMAGE_BYTES } from './catalog.service.js';

const uuid = new ParseUUIDPipe();
const categoryStatus = productStatusSchema;

@Controller('manager')
export class CatalogController {
  constructor(private readonly catalog: CatalogService) {}

  @RequirePermission('manager', 'catalog.read')
  @Get('categories')
  async categories(
    @CurrentMerchantActor() actor: MerchantActor,
  ): Promise<{ categories: Category[] }> {
    return { categories: await this.catalog.listCategories(actor) };
  }

  @RequirePermission('manager', 'catalog.manage')
  @Post('categories')
  createCategory(
    @CurrentMerchantActor() actor: MerchantActor,
    @Body(new ZodPipe(saveCategorySchema)) body: z.output<typeof saveCategorySchema>,
    @Req() req: FastifyRequest,
  ) {
    return this.catalog.saveCategory(actor, null, body, req.ip);
  }

  @RequirePermission('manager', 'catalog.manage')
  @Patch('categories/:id')
  updateCategory(
    @CurrentMerchantActor() actor: MerchantActor,
    @Param('id', uuid) id: string,
    @Body(new ZodPipe(saveCategorySchema)) body: z.output<typeof saveCategorySchema>,
    @Req() req: FastifyRequest,
  ) {
    return this.catalog.saveCategory(actor, id, body, req.ip);
  }

  @RequirePermission('manager', 'catalog.manage')
  @Post('categories/:id/status')
  categoryStatus(
    @CurrentMerchantActor() actor: MerchantActor,
    @Param('id', uuid) id: string,
    @Body(new ZodPipe(categoryStatus)) body: z.output<typeof categoryStatus>,
    @Req() req: FastifyRequest,
  ) {
    return this.catalog.setCategoryStatus(actor, id, body.status, req.ip);
  }

  @RequirePermission('manager', 'catalog.read')
  @Get('products')
  list(
    @CurrentMerchantActor() actor: MerchantActor,
    @Query(new ZodPipe(productListQuerySchema)) query: z.output<typeof productListQuerySchema>,
  ) {
    return this.catalog.listProducts(actor, query);
  }

  @RequirePermission('manager', 'catalog.read')
  @Get('products/:id')
  get(
    @CurrentMerchantActor() actor: MerchantActor,
    @Param('id', uuid) id: string,
  ): Promise<Product> {
    return this.catalog.getProduct(actor, id);
  }

  @RequirePermission('manager', 'catalog.manage')
  @Post('products')
  create(
    @CurrentMerchantActor() actor: MerchantActor,
    @Body(new ZodPipe(saveProductSchema)) body: z.output<typeof saveProductSchema>,
    @Req() req: FastifyRequest,
  ): Promise<Product> {
    return this.catalog.createProduct(actor, body, req.ip);
  }

  @RequirePermission('manager', 'catalog.manage')
  @Patch('products/:id')
  update(
    @CurrentMerchantActor() actor: MerchantActor,
    @Param('id', uuid) id: string,
    @Body(new ZodPipe(saveProductSchema)) body: z.output<typeof saveProductSchema>,
    @Req() req: FastifyRequest,
  ): Promise<Product> {
    return this.catalog.updateProduct(actor, id, body, req.ip);
  }

  @RequirePermission('manager', 'catalog.manage')
  @Post('products/:id/status')
  status(
    @CurrentMerchantActor() actor: MerchantActor,
    @Param('id', uuid) id: string,
    @Body(new ZodPipe(productStatusSchema)) body: z.output<typeof productStatusSchema>,
    @Req() req: FastifyRequest,
  ): Promise<Product> {
    return this.catalog.setProductStatus(actor, id, body.status, req.ip);
  }

  /** multipart/form-data with one `file` field. The content type is detected from the bytes. */
  @RequirePermission('manager', 'catalog.manage')
  @Post('products/:id/images')
  async upload(
    @CurrentMerchantActor() actor: MerchantActor,
    @Param('id', uuid) id: string,
    @Req() req: FastifyRequest,
  ): Promise<Product> {
    if (!req.isMultipart())
      throw new AppError(415, 'UNSUPPORTED_MEDIA', 'Send the image as multipart/form-data.');
    const file = await req.file({ limits: { fileSize: MAX_IMAGE_BYTES + 1, files: 1 } });
    if (!file)
      throw AppError.validation([
        { path: 'file', code: 'required', message: 'An image file is required.' },
      ]);
    const data = await file.toBuffer().catch(() => {
      throw new AppError(413, 'PAYLOAD_TOO_LARGE', 'Images must be at most 2 MB.');
    });
    if (file.file.truncated)
      throw new AppError(413, 'PAYLOAD_TOO_LARGE', 'Images must be at most 2 MB.');
    return this.catalog.addImage(actor, id, data, req.ip);
  }

  @RequirePermission('manager', 'catalog.manage')
  @Delete('products/:id/images/:imageId')
  deleteImage(
    @CurrentMerchantActor() actor: MerchantActor,
    @Param('id', uuid) id: string,
    @Param('imageId', uuid) imageId: string,
    @Req() req: FastifyRequest,
  ): Promise<Product> {
    return this.catalog.deleteImage(actor, id, imageId, req.ip);
  }

  @RequirePermission('manager', 'catalog.read')
  @Get('products/:id/images/:imageId')
  async image(
    @CurrentMerchantActor() actor: MerchantActor,
    @Param('id', uuid) id: string,
    @Param('imageId', uuid) imageId: string,
    @Res() reply: FastifyReply,
  ) {
    const { data, contentType } = await this.catalog.readImage(actor, id, imageId);
    await sendImage(reply, data, contentType);
  }
}

/** POS catalog: only products available at the session's branch (Prompt 7, POS integration). */
@Controller('pos/catalog')
export class PosCatalogController {
  constructor(private readonly catalog: CatalogService) {}

  @RequirePermission('pos', 'catalog.read')
  @Get()
  async get(
    @CurrentMerchantActor() actor: MerchantActor,
    @Headers('if-none-match') etag: string | undefined,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    const catalog: PosCatalog = await this.catalog.posCatalog(actor);
    const tag = `"${catalog.version}"`;
    void reply.header('etag', tag).header('cache-control', 'private, no-cache');
    if (etag === tag) {
      await reply.status(304).send();
      return;
    }
    await reply.send(catalog);
  }

  @RequirePermission('pos', 'catalog.read')
  @Get('images/:productId/:imageId')
  async image(
    @CurrentMerchantActor() actor: MerchantActor,
    @Param('productId', uuid) productId: string,
    @Param('imageId', uuid) imageId: string,
    @Res() reply: FastifyReply,
  ) {
    const { data, contentType } = await this.catalog.readPosImage(actor, productId, imageId);
    await sendImage(reply, data, contentType);
  }
}

async function sendImage(reply: FastifyReply, data: Buffer, contentType: string) {
  await reply
    .header('content-type', contentType)
    .header('cache-control', 'private, max-age=86400, immutable')
    .header('x-content-type-options', 'nosniff')
    .header('content-security-policy', "default-src 'none'")
    .send(data);
}
