import type { ManagerSubscription } from '@arabat/contracts';
import { Controller, Get } from '@nestjs/common';
import { RequirePermission } from '../../kernel/access/access.decorators.js';
import { CurrentMerchantActor } from '../../kernel/access/current-actor.js';
import type { MerchantActor } from '../../kernel/access/session-resolver.js';
import { SubscriptionsService } from './subscriptions.service.js';

@Controller('manager/subscription')
export class SubscriptionsController {
  constructor(private readonly subscriptions: SubscriptionsService) {}

  /** The merchant's own plan, status and usage; the merchant comes from the session only. */
  @RequirePermission('manager', 'merchant.settings.read')
  @Get()
  get(@CurrentMerchantActor() actor: MerchantActor): Promise<ManagerSubscription> {
    return this.subscriptions.managerView(actor);
  }
}
