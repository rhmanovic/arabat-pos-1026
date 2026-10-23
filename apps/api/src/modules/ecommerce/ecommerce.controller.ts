import {
  MAX_STORE_IMAGE_BYTES,
  type MockPayment,
  type OnlineCollection,
  type OnlineDeliveryArea,
  type OnlineOrder,
  type OnlineStore,
  type OnlineStoreBranch,
  type AccountOrderList,
  type AccountSession,
  type AccountView,
  type OnlinePromotion,
  type PosOnlineOrder,
  type PublicOrder,
  type StoreQuoteResult,
  type Sale,
  type SlugAvailability,
  type StoreCategory,
  type StoreProduct,
  type StoreSlotList,
  type Storefront,
  listingOrderSchema,
  mockPaymentOutcomeSchema,
  onlineCollectionOrderSchema,
  onlineDeliveryAreaOrderSchema,
  onlineOrderActionSchema,
  onlineOrderListQuerySchema,
  onlineStoreBranchOrderSchema,
  posOnlineOrderCompleteSchema,
  posOnlineOrderPaySchema,
  accountForgotSchema,
  accountLoginSchema,
  accountPasswordSchema,
  accountRegisterSchema,
  accountResetSchema,
  accountUpdateSchema,
  onlinePromotionOrderSchema,
  saveCustomerAddressSchema,
  saveOnlinePromotionSchema,
  storeQuoteSchema,
  saveListingSchema,
  saveListingsSchema,
  saveOnlineCollectionSchema,
  saveStoreCategorySchema,
  storeCategoryOrderSchema,
  saveOnlineDeliveryAreaSchema,
  saveOnlineStoreBranchSchema,
  saveOnlineStoreSchema,
  slugAvailabilityQuerySchema,
  storeCheckoutSchema,
} from '@arabat/contracts';
import { z } from 'zod';
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
import { Public, RequirePermission } from '../../kernel/access/access.decorators.js';
import { CurrentMerchantActor } from '../../kernel/access/current-actor.js';
import type { MerchantActor } from '../../kernel/access/session-resolver.js';
import { AppError } from '../../kernel/errors/app-error.js';
import { ZodPipe } from '../../kernel/validation/zod.pipe.js';
import { RateLimiterService } from '../auth/rate-limiter.service.js';
import { EcommerceService } from './ecommerce.service.js';
import { FulfilmentService } from './fulfilment.service.js';
import { PosHandoverService } from './pos-handover.service.js';
import { PromotionsService } from './promotions.service.js';
import { StoreShareService } from './store-share.service.js';
import { StoreAccountsService } from './store-accounts.service.js';
import { OnlinePaymentsService } from './online-payments.service.js';

const uuid = new ParseUUIDPipe();
type O<T extends z.ZodType> = z.output<T>;
const CHECKOUT_LIMIT = { limit: 30, windowSeconds: 600 };
const QUOTE_LIMIT = { limit: 120, windowSeconds: 600 };
const ACCOUNT_LIMIT = { limit: 20, windowSeconds: 600 };
const branchQuerySchema = z.object({
  branch: z
    .uuid()
    .optional()
    .transform((v) => v ?? null),
});
const slotsQuerySchema = branchQuerySchema.extend({
  fulfillment: z.enum(['pickup', 'delivery']).default('pickup'),
});

/** One `file` field of a multipart request, at most `MAX_STORE_IMAGE_BYTES` (ADR-0121). */
export async function readUpload(req: FastifyRequest): Promise<Buffer> {
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

export const sendImage = (
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
  constructor(
    private readonly store: EcommerceService,
    private readonly fulfilment: FulfilmentService,
    private readonly promotions: PromotionsService,
  ) {}

  // ---------------------------------------------------------------- promotions (ADR-0125)
  @RequirePermission('manager', 'online.manage')
  @Get('promotions')
  promotionList(
    @CurrentMerchantActor() actor: MerchantActor,
  ): Promise<{ promotions: OnlinePromotion[] }> {
    return this.promotions.list(actor);
  }

  @RequirePermission('manager', 'online.manage')
  @Post('promotions')
  createPromotion(
    @CurrentMerchantActor() actor: MerchantActor,
    @Body(new ZodPipe(saveOnlinePromotionSchema)) body: O<typeof saveOnlinePromotionSchema>,
    @Req() req: FastifyRequest,
  ): Promise<OnlinePromotion> {
    return this.promotions.create(actor, body, req.ip);
  }

  @RequirePermission('manager', 'online.manage')
  @Put('promotions/order')
  orderPromotions(
    @CurrentMerchantActor() actor: MerchantActor,
    @Body(new ZodPipe(onlinePromotionOrderSchema)) body: O<typeof onlinePromotionOrderSchema>,
    @Req() req: FastifyRequest,
  ): Promise<{ promotions: OnlinePromotion[] }> {
    return this.promotions.order(actor, body.ids, req.ip);
  }

  @RequirePermission('manager', 'online.manage')
  @Put('promotions/:id')
  updatePromotion(
    @CurrentMerchantActor() actor: MerchantActor,
    @Param('id', uuid) id: string,
    @Body(new ZodPipe(saveOnlinePromotionSchema)) body: O<typeof saveOnlinePromotionSchema>,
    @Req() req: FastifyRequest,
  ): Promise<OnlinePromotion> {
    return this.promotions.update(actor, id, body, req.ip);
  }

  @RequirePermission('manager', 'online.manage')
  @Delete('promotions/:id')
  deletePromotion(
    @CurrentMerchantActor() actor: MerchantActor,
    @Param('id', uuid) id: string,
    @Req() req: FastifyRequest,
  ): Promise<{ promotions: OnlinePromotion[] }> {
    return this.promotions.remove(actor, id, req.ip);
  }

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
    return this.store.setListings(actor, body, req.ip);
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

  // ---------------------------------------------------------------- categories (ADR-0130)
  /** The shared catalog categories with the store's settings. */
  @RequirePermission('manager', 'online.manage')
  @Get('categories')
  categories(@CurrentMerchantActor() actor: MerchantActor) {
    return this.store.categories(actor);
  }

  /** A new shared category (also `catalog.manage`, checked in the service). */
  @RequirePermission('manager', 'online.manage')
  @Post('categories')
  createCategory(
    @CurrentMerchantActor() actor: MerchantActor,
    @Body(new ZodPipe(saveStoreCategorySchema)) body: O<typeof saveStoreCategorySchema>,
    @Req() req: FastifyRequest,
  ): Promise<StoreCategory> {
    return this.store.createCategory(actor, body, req.ip);
  }

  @RequirePermission('manager', 'online.manage')
  @Put('categories/order')
  orderCategories(
    @CurrentMerchantActor() actor: MerchantActor,
    @Body(new ZodPipe(storeCategoryOrderSchema)) body: O<typeof storeCategoryOrderSchema>,
    @Req() req: FastifyRequest,
  ) {
    return this.store.orderCategories(actor, body.ids, req.ip);
  }

  @RequirePermission('manager', 'online.manage')
  @Put('categories/:id')
  updateCategory(
    @CurrentMerchantActor() actor: MerchantActor,
    @Param('id', uuid) id: string,
    @Body(new ZodPipe(saveStoreCategorySchema)) body: O<typeof saveStoreCategorySchema>,
    @Req() req: FastifyRequest,
  ): Promise<StoreCategory> {
    return this.store.updateCategory(actor, id, body, req.ip);
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
  ): Promise<StoreCategory> {
    return this.store.setCategoryImage(actor, id, await readUpload(req), req.ip);
  }

  @RequirePermission('manager', 'online.manage')
  @Delete('categories/:id/image')
  removeCategoryImage(
    @CurrentMerchantActor() actor: MerchantActor,
    @Param('id', uuid) id: string,
    @Req() req: FastifyRequest,
  ): Promise<StoreCategory> {
    return this.store.setCategoryImage(actor, id, null, req.ip);
  }

  // ---------------------------------------------------------------- collections (ADR-0130)
  @RequirePermission('manager', 'online.manage')
  @Get('collections')
  collections(@CurrentMerchantActor() actor: MerchantActor) {
    return this.store.collections(actor);
  }

  @RequirePermission('manager', 'online.manage')
  @Post('collections')
  createCollection(
    @CurrentMerchantActor() actor: MerchantActor,
    @Body(new ZodPipe(saveOnlineCollectionSchema)) body: O<typeof saveOnlineCollectionSchema>,
    @Req() req: FastifyRequest,
  ): Promise<OnlineCollection> {
    return this.store.createCollection(actor, body, req.ip);
  }

  @RequirePermission('manager', 'online.manage')
  @Put('collections/order')
  orderCollections(
    @CurrentMerchantActor() actor: MerchantActor,
    @Body(new ZodPipe(onlineCollectionOrderSchema)) body: O<typeof onlineCollectionOrderSchema>,
    @Req() req: FastifyRequest,
  ) {
    return this.store.orderCollections(actor, body.ids, req.ip);
  }

  @RequirePermission('manager', 'online.manage')
  @Put('collections/:id')
  updateCollection(
    @CurrentMerchantActor() actor: MerchantActor,
    @Param('id', uuid) id: string,
    @Body(new ZodPipe(saveOnlineCollectionSchema)) body: O<typeof saveOnlineCollectionSchema>,
    @Req() req: FastifyRequest,
  ): Promise<OnlineCollection> {
    return this.store.updateCollection(actor, id, body, req.ip);
  }

  @RequirePermission('manager', 'online.manage')
  @Delete('collections/:id')
  deleteCollection(
    @CurrentMerchantActor() actor: MerchantActor,
    @Param('id', uuid) id: string,
    @Req() req: FastifyRequest,
  ) {
    return this.store.deleteCollection(actor, id, req.ip);
  }

  @RequirePermission('manager', 'online.manage')
  @Get('collections/:id/image')
  async collectionImage(
    @CurrentMerchantActor() actor: MerchantActor,
    @Param('id', uuid) id: string,
    @Res() reply: FastifyReply,
  ) {
    await sendImage(reply, await this.store.collectionImage(actor, id), 'private, no-cache');
  }

  @RequirePermission('manager', 'online.manage')
  @Post('collections/:id/image')
  @HttpCode(200)
  async uploadCollectionImage(
    @CurrentMerchantActor() actor: MerchantActor,
    @Param('id', uuid) id: string,
    @Req() req: FastifyRequest,
  ): Promise<OnlineCollection> {
    return this.store.setCollectionImage(actor, id, await readUpload(req), req.ip);
  }

  @RequirePermission('manager', 'online.manage')
  @Delete('collections/:id/image')
  removeCollectionImage(
    @CurrentMerchantActor() actor: MerchantActor,
    @Param('id', uuid) id: string,
    @Req() req: FastifyRequest,
  ): Promise<OnlineCollection> {
    return this.store.setCollectionImage(actor, id, null, req.ip);
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

  // ---------------------------------------------------------------- fulfilment (ADR-0123)
  @RequirePermission('manager', 'online.manage')
  @Get('delivery-areas')
  deliveryAreas(
    @CurrentMerchantActor() actor: MerchantActor,
  ): Promise<{ areas: OnlineDeliveryArea[] }> {
    return this.fulfilment.areas(actor);
  }

  @RequirePermission('manager', 'online.manage')
  @Post('delivery-areas')
  createDeliveryArea(
    @CurrentMerchantActor() actor: MerchantActor,
    @Body(new ZodPipe(saveOnlineDeliveryAreaSchema)) body: O<typeof saveOnlineDeliveryAreaSchema>,
    @Req() req: FastifyRequest,
  ): Promise<OnlineDeliveryArea> {
    return this.fulfilment.createArea(actor, body, req.ip);
  }

  @RequirePermission('manager', 'online.manage')
  @Put('delivery-areas/order')
  orderDeliveryAreas(
    @CurrentMerchantActor() actor: MerchantActor,
    @Body(new ZodPipe(onlineDeliveryAreaOrderSchema)) body: O<typeof onlineDeliveryAreaOrderSchema>,
    @Req() req: FastifyRequest,
  ): Promise<{ areas: OnlineDeliveryArea[] }> {
    return this.fulfilment.orderAreas(actor, body.ids, req.ip);
  }

  @RequirePermission('manager', 'online.manage')
  @Put('delivery-areas/:id')
  updateDeliveryArea(
    @CurrentMerchantActor() actor: MerchantActor,
    @Param('id', uuid) id: string,
    @Body(new ZodPipe(saveOnlineDeliveryAreaSchema)) body: O<typeof saveOnlineDeliveryAreaSchema>,
    @Req() req: FastifyRequest,
  ): Promise<OnlineDeliveryArea> {
    return this.fulfilment.updateArea(actor, id, body, req.ip);
  }

  @RequirePermission('manager', 'online.manage')
  @Delete('delivery-areas/:id')
  deleteDeliveryArea(
    @CurrentMerchantActor() actor: MerchantActor,
    @Param('id', uuid) id: string,
    @Req() req: FastifyRequest,
  ): Promise<{ areas: OnlineDeliveryArea[] }> {
    return this.fulfilment.deleteArea(actor, id, req.ip);
  }

  @RequirePermission('manager', 'online.manage')
  @Get('branches')
  storeBranches(
    @CurrentMerchantActor() actor: MerchantActor,
  ): Promise<{ branches: OnlineStoreBranch[] }> {
    return this.fulfilment.storeBranches(actor);
  }

  @RequirePermission('manager', 'online.manage')
  @Put('branches/order')
  orderStoreBranches(
    @CurrentMerchantActor() actor: MerchantActor,
    @Body(new ZodPipe(onlineStoreBranchOrderSchema)) body: O<typeof onlineStoreBranchOrderSchema>,
    @Req() req: FastifyRequest,
  ): Promise<{ branches: OnlineStoreBranch[] }> {
    return this.fulfilment.orderStoreBranches(actor, body.branchIds, req.ip);
  }

  @RequirePermission('manager', 'online.manage')
  @Put('branches/:branchId')
  saveStoreBranch(
    @CurrentMerchantActor() actor: MerchantActor,
    @Param('branchId', uuid) branchId: string,
    @Body(new ZodPipe(saveOnlineStoreBranchSchema)) body: O<typeof saveOnlineStoreBranchSchema>,
    @Req() req: FastifyRequest,
  ): Promise<OnlineStoreBranch> {
    return this.fulfilment.saveStoreBranch(actor, branchId, body, req.ip);
  }

  @RequirePermission('manager', 'online.manage')
  @Delete('branches/:branchId')
  removeStoreBranch(
    @CurrentMerchantActor() actor: MerchantActor,
    @Param('branchId', uuid) branchId: string,
    @Req() req: FastifyRequest,
  ): Promise<{ branches: OnlineStoreBranch[] }> {
    return this.fulfilment.removeStoreBranch(actor, branchId, req.ip);
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
    private readonly accounts: StoreAccountsService,
    private readonly share: StoreShareService,
  ) {}

  /** The picture of a link preview (ADR-0134): a JPEG of the product, category or logo. */
  @Public()
  @Get('share.jpg')
  async shareImage(
    @Param('slug') slug: string,
    @Query('product') product: string | undefined,
    @Query('category') category: string | undefined,
    @Res() reply: FastifyReply,
  ) {
    const data = await this.share.image(slug, {
      product: product ?? null,
      category: category ?? null,
    });
    await reply
      .header('content-type', 'image/jpeg')
      .header('cache-control', 'public, max-age=86400')
      .header('x-content-type-options', 'nosniff')
      .send(data);
  }

  @Public()
  @Get()
  storefront(@Param('slug') slug: string): Promise<Storefront> {
    return this.store.storefront(slug);
  }

  @Public()
  @Get('products')
  products(
    @Param('slug') slug: string,
    @Query(new ZodPipe(branchQuerySchema)) query: O<typeof branchQuerySchema>,
  ): Promise<{ products: StoreProduct[] }> {
    return this.store.products(slug, query.branch);
  }

  @Public()
  @Get('products/:productId')
  product(
    @Param('slug') slug: string,
    @Param('productId', uuid) productId: string,
    @Query(new ZodPipe(branchQuerySchema)) query: O<typeof branchQuerySchema>,
  ): Promise<StoreProduct> {
    return this.store.product(slug, productId, query.branch);
  }

  /** Time slots a shopper may pick (ADR-0123); empty when the store does not schedule. */
  @Public()
  @Get('slots')
  slots(
    @Param('slug') slug: string,
    @Query(new ZodPipe(slotsQuerySchema)) query: O<typeof slotsQuerySchema>,
  ): Promise<StoreSlotList> {
    return this.store.slots(slug, query);
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
  @Get('collections/:id/image')
  async collectionImage(
    @Param('slug') slug: string,
    @Param('id', uuid) id: string,
    @Res() reply: FastifyReply,
  ) {
    await sendImage(
      reply,
      await this.store.publicImage(slug, { collectionId: id }),
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
    const customer = await this.accounts.resolve(req.headers.authorization);
    return { order: await this.store.checkout(slug, body, req.ip, customer) };
  }

  /** Prices a cart with the promotion that applies, before the order is placed (ADR-0125). */
  @Public()
  @Post('quote')
  async quote(
    @Param('slug') slug: string,
    @Body(new ZodPipe(storeQuoteSchema)) body: O<typeof storeQuoteSchema>,
    @Req() req: FastifyRequest,
  ): Promise<StoreQuoteResult> {
    await this.limiter.consume(`store-quote:${req.ip}`, QUOTE_LIMIT);
    const customer = await this.accounts.resolve(req.headers.authorization);
    return this.store.quote(slug, body, customer);
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

/** Online orders handed over at the till (ADR-0123): the cashier's bound branch, open shift. */
@Controller('pos/online-orders')
export class PosOnlineOrdersController {
  constructor(private readonly handover: PosHandoverService) {}

  @RequirePermission('pos', 'sales.create')
  @Get()
  list(@CurrentMerchantActor() actor: MerchantActor): Promise<{ orders: PosOnlineOrder[] }> {
    return this.handover.list(actor);
  }

  @RequirePermission('pos', 'sales.create')
  @Post(':id/pay')
  pay(
    @CurrentMerchantActor() actor: MerchantActor,
    @Param('id', uuid) id: string,
    @Body(new ZodPipe(posOnlineOrderPaySchema)) body: O<typeof posOnlineOrderPaySchema>,
    @Req() req: FastifyRequest,
  ): Promise<Sale> {
    return this.handover.pay(actor, id, body, req.ip);
  }

  @RequirePermission('pos', 'sales.create')
  @Post(':id/complete')
  complete(
    @CurrentMerchantActor() actor: MerchantActor,
    @Param('id', uuid) id: string,
    @Body(new ZodPipe(posOnlineOrderCompleteSchema)) body: O<typeof posOnlineOrderCompleteSchema>,
    @Req() req: FastifyRequest,
  ): Promise<PosOnlineOrder> {
    return this.handover.complete(actor, id, body, req.ip);
  }
}

/** Shopper accounts of a store (ADR-0124): bearer token in `Authorization: Bearer st_…`. */
@Controller('store/:slug/account')
export class StoreAccountController {
  constructor(
    private readonly store: EcommerceService,
    private readonly accounts: StoreAccountsService,
    private readonly limiter: RateLimiterService,
  ) {}

  private async signedIn(slug: string, req: FastifyRequest) {
    const merchantId = await this.store.merchantIdOf(slug);
    return this.accounts.assertStore(
      await this.accounts.resolve(req.headers.authorization),
      merchantId,
    );
  }

  @Public()
  @Post('register')
  async register(
    @Param('slug') slug: string,
    @Body(new ZodPipe(accountRegisterSchema)) body: O<typeof accountRegisterSchema>,
    @Req() req: FastifyRequest,
  ): Promise<AccountSession> {
    await this.limiter.consume(`store-account:${req.ip}`, ACCOUNT_LIMIT);
    return this.accounts.register(await this.store.merchantIdOf(slug), body, req.ip);
  }

  @Public()
  @Post('login')
  @HttpCode(200)
  async login(
    @Param('slug') slug: string,
    @Body(new ZodPipe(accountLoginSchema)) body: O<typeof accountLoginSchema>,
    @Req() req: FastifyRequest,
  ): Promise<AccountSession> {
    await this.limiter.consume(`store-account:${req.ip}`, ACCOUNT_LIMIT);
    return this.accounts.login(await this.store.merchantIdOf(slug), body, req.ip);
  }

  @Public()
  @Post('logout')
  @HttpCode(204)
  async logout(@Param('slug') slug: string, @Req() req: FastifyRequest): Promise<void> {
    const merchantId = await this.store.merchantIdOf(slug);
    const customer = await this.accounts.resolve(req.headers.authorization);
    if (customer && customer.merchantId === merchantId) await this.accounts.logout(customer);
  }

  @Public()
  @Get()
  async me(@Param('slug') slug: string, @Req() req: FastifyRequest): Promise<AccountView> {
    return this.accounts.me(await this.signedIn(slug, req));
  }

  @Public()
  @Put()
  async update(
    @Param('slug') slug: string,
    @Body(new ZodPipe(accountUpdateSchema)) body: O<typeof accountUpdateSchema>,
    @Req() req: FastifyRequest,
  ): Promise<AccountView> {
    return this.accounts.update(await this.signedIn(slug, req), body, req.ip);
  }

  @Public()
  @Put('password')
  @HttpCode(204)
  async password(
    @Param('slug') slug: string,
    @Body(new ZodPipe(accountPasswordSchema)) body: O<typeof accountPasswordSchema>,
    @Req() req: FastifyRequest,
  ): Promise<void> {
    await this.accounts.changePassword(await this.signedIn(slug, req), body, req.ip);
  }

  @Public()
  @Post('forgot')
  @HttpCode(204)
  async forgot(
    @Param('slug') slug: string,
    @Body(new ZodPipe(accountForgotSchema)) body: O<typeof accountForgotSchema>,
    @Req() req: FastifyRequest,
  ): Promise<void> {
    await this.limiter.consume(`store-account:${req.ip}`, ACCOUNT_LIMIT);
    await this.accounts.forgot(await this.store.merchantIdOf(slug), slug, body.email, req.ip);
  }

  @Public()
  @Post('reset')
  @HttpCode(204)
  async reset(
    @Param('slug') slug: string,
    @Body(new ZodPipe(accountResetSchema)) body: O<typeof accountResetSchema>,
    @Req() req: FastifyRequest,
  ): Promise<void> {
    await this.limiter.consume(`store-account:${req.ip}`, ACCOUNT_LIMIT);
    await this.accounts.reset(await this.store.merchantIdOf(slug), body, req.ip);
  }

  @Public()
  @Get('orders')
  async orders(@Param('slug') slug: string, @Req() req: FastifyRequest): Promise<AccountOrderList> {
    return this.accounts.orders(await this.signedIn(slug, req));
  }

  @Public()
  @Post('addresses')
  async addAddress(
    @Param('slug') slug: string,
    @Body(new ZodPipe(saveCustomerAddressSchema)) body: O<typeof saveCustomerAddressSchema>,
    @Req() req: FastifyRequest,
  ): Promise<AccountView> {
    return this.accounts.saveAddress(await this.signedIn(slug, req), null, body);
  }

  @Public()
  @Put('addresses/:id')
  async updateAddress(
    @Param('slug') slug: string,
    @Param('id', uuid) id: string,
    @Body(new ZodPipe(saveCustomerAddressSchema)) body: O<typeof saveCustomerAddressSchema>,
    @Req() req: FastifyRequest,
  ): Promise<AccountView> {
    return this.accounts.saveAddress(await this.signedIn(slug, req), id, body);
  }

  @Public()
  @Delete('addresses/:id')
  async deleteAddress(
    @Param('slug') slug: string,
    @Param('id', uuid) id: string,
    @Req() req: FastifyRequest,
  ): Promise<AccountView> {
    return this.accounts.deleteAddress(await this.signedIn(slug, req), id);
  }
}
