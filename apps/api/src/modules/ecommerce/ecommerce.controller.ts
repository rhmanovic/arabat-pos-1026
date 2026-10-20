import {
  MAX_STORE_IMAGE_BYTES,
  type MockPayment,
  type OnlineCategory,
  type OnlineOrder,
  type OnlineStore,
  type PublicOrder,
  type SlugAvailability,
  type StoreProduct,
  type Storefront,
  listingOrderSchema,
  mockPaymentOutcomeSchema,
  onlineCategoryOrderSchema,
  onlineOrderActionSchema,
  onlineOrderListQuerySchema,
  saveListingSchema,
  saveListingsSchema,
  saveOnlineCategorySchema,
  saveOnlineStoreSchema,
  slugAvailabilityQuerySchema,
  storeCheckoutSchema,
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
  type RawBodyRequest,
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
import { EcommerceService } from './ecommerce.service.js';
import { OnlinePaymentsService } from './online-payments.service.js';

const uuid = new ParseUUIDPipe();
type O<T extends z.ZodType> = z.output<T>;
const CHECKOUT_LIMIT = { limit: 30, windowSeconds: 600 };

/** One `file` field of a multipart request, at most `MAX_STORE_IMAGE_BYTES` (ADR-0121). */
async function readUpload(req: FastifyRequest): Promise<Buffer> {
  if (!req.isMultipart())
    throw new AppError(415, 'UNSUPPORTED_MEDIA', 'Send the image as multipart/form-data.');
  const file = await req.file({ limits: { fileSize: MAX_STORE_IMAGE_BYTES + 1, files: 1 } });
  if (!file)
    throw AppError.validation([
      { path: 'file', code: 'required', message: 'An image file is required.' },
    ]);
  const data = await file.toBuffer().catch(() => {
    throw new AppError(413, 'PAYLOAD_TOO_LARGE', 'Images must be at most 2 MB.');
  });
  if (file.file.truncated)
    throw new AppError(413, 'PAYLOAD_TOO_LARGE', 'Images must be at most 2 MB.');
  return data;
}

const sendImage = (
  reply: FastifyReply,
  image: { data: Buffer; contentType: string },
  cache: string,
) =>
  reply
    .header('content-type', image.contentType)
    .header('cache-control', cache)
    .header('x-content-type-options', 'nosniff')
    .send(image.data);

function storeImageKind(kind: string): 'logo' | 'banner' {
  if (kind !== 'logo' && kind !== 'banner') throw AppError.notFound();
  return kind;
}

@Controller('manager/online')
export class OnlineManagerController {
  constructor(private readonly store: EcommerceService) {}

  @RequirePermission('manager', 'online.manage')
  @Get('store')
  get(@CurrentMerchantActor() actor: MerchantActor): Promise<OnlineStore> {
    return this.store.store(actor);
  }

  @RequirePermission('manager', 'online.manage')
  @Put('store')
  save(
    @CurrentMerchantActor() actor: MerchantActor,
    @Body(new ZodPipe(saveOnlineStoreSchema)) body: O<typeof saveOnlineStoreSchema>,
    @Req() req: FastifyRequest,
  ): Promise<OnlineStore> {
    return this.store.saveStore(actor, body, req.ip);
  }

  @RequirePermission('manager', 'online.manage')
  @Get('store/slug-availability')
  slugAvailability(
    @CurrentMerchantActor() actor: MerchantActor,
    @Query(new ZodPipe(slugAvailabilityQuerySchema)) q: O<typeof slugAvailabilityQuerySchema>,
  ): Promise<SlugAvailability> {
    return this.store.slugAvailability(actor, q.slug);
  }

  @RequirePermission('manager', 'online.orders')
  @Get('tenders')
  tenders(@CurrentMerchantActor() actor: MerchantActor) {
    return this.store.tenders(actor);
  }

  @RequirePermission('manager', 'online.manage')
  @Get('listings')
  listings(@CurrentMerchantActor() actor: MerchantActor) {
    return this.store.listings(actor);
  }

  @RequirePermission('manager', 'online.manage')
  @Put('listings')
  setListings(
    @CurrentMerchantActor() actor: MerchantActor,
    @Body(new ZodPipe(saveListingsSchema)) body: O<typeof saveListingsSchema>,
    @Req() req: FastifyRequest,
  ) {
    return this.store.setListings(
      actor,
      body.productIds,
      body.listed,
      req.ip,
      body.onlineCategoryId,
    );
  }

  @RequirePermission('manager', 'online.manage')
  @Put('listings/order')
  orderListings(
    @CurrentMerchantActor() actor: MerchantActor,
    @Body(new ZodPipe(listingOrderSchema)) body: O<typeof listingOrderSchema>,
    @Req() req: FastifyRequest,
  ) {
    return this.store.orderListings(actor, body.productIds, req.ip);
  }

  @RequirePermission('manager', 'online.manage')
  @Put('listings/:productId')
  saveListing(
    @CurrentMerchantActor() actor: MerchantActor,
    @Param('productId', uuid) productId: string,
    @Body(new ZodPipe(saveListingSchema)) body: O<typeof saveListingSchema>,
    @Req() req: FastifyRequest,
  ) {
    return this.store.saveListing(actor, productId, body, req.ip);
  }

  // ---------------------------------------------------------------- categories (ADR-0121)
  @RequirePermission('manager', 'online.manage')
  @Get('categories')
  categories(@CurrentMerchantActor() actor: MerchantActor) {
    return this.store.categories(actor);
  }

  @RequirePermission('manager', 'online.manage')
  @Post('categories')
  createCategory(
    @CurrentMerchantActor() actor: MerchantActor,
    @Body(new ZodPipe(saveOnlineCategorySchema)) body: O<typeof saveOnlineCategorySchema>,
    @Req() req: FastifyRequest,
  ): Promise<OnlineCategory> {
    return this.store.createCategory(actor, body, req.ip);
  }

  @RequirePermission('manager', 'online.manage')
  @Put('categories/order')
  orderCategories(
    @CurrentMerchantActor() actor: MerchantActor,
    @Body(new ZodPipe(onlineCategoryOrderSchema)) body: O<typeof onlineCategoryOrderSchema>,
    @Req() req: FastifyRequest,
  ) {
    return this.store.orderCategories(actor, body.ids, req.ip);
  }

  @RequirePermission('manager', 'online.manage')
  @Put('categories/:id')
  updateCategory(
    @CurrentMerchantActor() actor: MerchantActor,
    @Param('id', uuid) id: string,
    @Body(new ZodPipe(saveOnlineCategorySchema)) body: O<typeof saveOnlineCategorySchema>,
    @Req() req: FastifyRequest,
  ): Promise<OnlineCategory> {
    return this.store.updateCategory(actor, id, body, req.ip);
  }

  @RequirePermission('manager', 'online.manage')
  @Delete('categories/:id')
  deleteCategory(
    @CurrentMerchantActor() actor: MerchantActor,
    @Param('id', uuid) id: string,
    @Req() req: FastifyRequest,
  ) {
    return this.store.deleteCategory(actor, id, req.ip);
  }

  @RequirePermission('manager', 'online.manage')
  @Get('categories/:id/image')
  async categoryImage(
    @CurrentMerchantActor() actor: MerchantActor,
    @Param('id', uuid) id: string,
    @Res() reply: FastifyReply,
  ) {
    await sendImage(reply, await this.store.categoryImage(actor, id), 'private, no-cache');
  }

  @RequirePermission('manager', 'online.manage')
  @Post('categories/:id/image')
  @HttpCode(200)
  async uploadCategoryImage(
    @CurrentMerchantActor() actor: MerchantActor,
    @Param('id', uuid) id: string,
    @Req() req: FastifyRequest,
  ): Promise<OnlineCategory> {
    return this.store.setCategoryImage(actor, id, await readUpload(req), req.ip);
  }

  @RequirePermission('manager', 'online.manage')
  @Delete('categories/:id/image')
  removeCategoryImage(
    @CurrentMerchantActor() actor: MerchantActor,
    @Param('id', uuid) id: string,
    @Req() req: FastifyRequest,
  ): Promise<OnlineCategory> {
    return this.store.setCategoryImage(actor, id, null, req.ip);
  }

  // ---------------------------------------------------------------- store images (ADR-0121)
  @RequirePermission('manager', 'online.manage')
  @Get('store/:kind(logo|banner)')
  async storeImage(
    @CurrentMerchantActor() actor: MerchantActor,
    @Param('kind') kind: string,
    @Res() reply: FastifyReply,
  ) {
    await sendImage(
      reply,
      await this.store.storeImage(actor, storeImageKind(kind)),
      'private, no-cache',
    );
  }

  @RequirePermission('manager', 'online.manage')
  @Post('store/:kind(logo|banner)')
  @HttpCode(200)
  async uploadStoreImage(
    @CurrentMerchantActor() actor: MerchantActor,
    @Param('kind') kind: string,
    @Req() req: FastifyRequest,
  ): Promise<OnlineStore> {
    return this.store.setStoreImage(actor, storeImageKind(kind), await readUpload(req), req.ip);
  }

  @RequirePermission('manager', 'online.manage')
  @Delete('store/:kind(logo|banner)')
  removeStoreImage(
    @CurrentMerchantActor() actor: MerchantActor,
    @Param('kind') kind: string,
    @Req() req: FastifyRequest,
  ): Promise<OnlineStore> {
    return this.store.setStoreImage(actor, storeImageKind(kind), null, req.ip);
  }

  @RequirePermission('manager', 'online.orders')
  @Get('orders')
  orders(
    @CurrentMerchantActor() actor: MerchantActor,
    @Query(new ZodPipe(onlineOrderListQuerySchema)) q: O<typeof onlineOrderListQuerySchema>,
  ) {
    return this.store.listOrders(actor, q);
  }

  @RequirePermission('manager', 'online.orders')
  @Get('orders/:id')
  order(
    @CurrentMerchantActor() actor: MerchantActor,
    @Param('id', uuid) id: string,
  ): Promise<OnlineOrder> {
    return this.store.getOrder(actor, id);
  }

  @RequirePermission('manager', 'online.orders')
  @Post('orders/:id/action')
  @HttpCode(200)
  act(
    @CurrentMerchantActor() actor: MerchantActor,
    @Param('id', uuid) id: string,
    @Body(new ZodPipe(onlineOrderActionSchema)) body: O<typeof onlineOrderActionSchema>,
    @Req() req: FastifyRequest,
  ): Promise<OnlineOrder> {
    return this.store.act(actor, id, body, req.ip);
  }

  @RequirePermission('manager', 'online.manage')
  @Post('reconcile')
  @HttpCode(200)
  reconcile(@CurrentMerchantActor() actor: MerchantActor) {
    return this.store.reconcileNow(actor);
  }
}

/** Public storefront API: resolved by store address, never by a client-supplied merchant id. */
@Controller('store/:slug')
export class StorefrontController {
  constructor(
    private readonly store: EcommerceService,
    private readonly limiter: RateLimiterService,
  ) {}

  @Public()
  @Get()
  storefront(@Param('slug') slug: string): Promise<Storefront> {
    return this.store.storefront(slug);
  }

  @Public()
  @Get('products')
  products(@Param('slug') slug: string): Promise<{ products: StoreProduct[] }> {
    return this.store.products(slug);
  }

  @Public()
  @Get('products/:productId')
  product(
    @Param('slug') slug: string,
    @Param('productId', uuid) productId: string,
  ): Promise<StoreProduct> {
    return this.store.product(slug, productId);
  }

  @Public()
  @Get('images/:productId/:imageId')
  async image(
    @Param('slug') slug: string,
    @Param('productId', uuid) productId: string,
    @Param('imageId', uuid) imageId: string,
    @Res() reply: FastifyReply,
  ) {
    await sendImage(
      reply,
      await this.store.image(slug, productId, imageId),
      'public, max-age=86400, immutable',
    );
  }

  /** Logo and banner (ADR-0121); the `?v=` in their URLs changes with every store update. */
  @Public()
  @Get(':kind(logo|banner)')
  async storeImage(
    @Param('slug') slug: string,
    @Param('kind') kind: string,
    @Res() reply: FastifyReply,
  ) {
    await sendImage(
      reply,
      await this.store.publicImage(slug, storeImageKind(kind)),
      'public, max-age=86400',
    );
  }

  @Public()
  @Get('categories/:id/image')
  async categoryImage(
    @Param('slug') slug: string,
    @Param('id', uuid) id: string,
    @Res() reply: FastifyReply,
  ) {
    await sendImage(
      reply,
      await this.store.publicImage(slug, { categoryId: id }),
      'public, max-age=86400',
    );
  }

  @Public()
  @Post('checkout')
  async checkout(
    @Param('slug') slug: string,
    @Body(new ZodPipe(storeCheckoutSchema)) body: O<typeof storeCheckoutSchema>,
    @Req() req: FastifyRequest,
  ): Promise<{ order: PublicOrder }> {
    await this.limiter.consume(`store-checkout:${req.ip}`, CHECKOUT_LIMIT);
    return { order: await this.store.checkout(slug, body, req.ip) };
  }

  @Public()
  @Get('orders/:token')
  track(@Param('slug') slug: string, @Param('token') token: string): Promise<PublicOrder> {
    if (!/^[0-9a-f]{32}$/.test(token)) throw AppError.notFound('Order not found.');
    return this.store.track(slug, token);
  }
}

@Controller()
export class PaymentsGatewayController {
  constructor(
    private readonly store: EcommerceService,
    private readonly payments: OnlinePaymentsService,
  ) {}

  /** Provider notifications (signature-verified, idempotent per event). */
  @Public()
  @Post('webhooks/payments/:provider')
  @HttpCode(200)
  webhook(@Param('provider') provider: string, @Req() req: RawBodyRequest<FastifyRequest>) {
    if (!req.rawBody)
      throw AppError.validation([{ path: 'body', code: 'required', message: 'Body required.' }]);
    return this.payments.handleWebhook(provider, req.headers, req.rawBody);
  }

  /** Mock gateway hosted page data (test payments only; disabled in production). */
  @Public()
  @Get('payments/mock/:reference')
  mock(@Param('reference') reference: string): Promise<MockPayment> {
    return this.store.mockPayment(reference);
  }

  @Public()
  @Post('payments/mock/:reference')
  @HttpCode(200)
  mockComplete(
    @Param('reference') reference: string,
    @Body(new ZodPipe(mockPaymentOutcomeSchema)) body: O<typeof mockPaymentOutcomeSchema>,
  ): Promise<MockPayment> {
    return this.store.mockComplete(reference, body.outcome);
  }
}
