import { Money } from '@arabat/money';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { ENV } from '../../config/config.module.js';
import { storeAddress } from '../../kernel/http/store-host.js';
import { StoreAddressService } from './store-address.service.js';
import type { Env } from '../../config/env.js';
import { DatabaseService } from '../../database/database.service.js';
import { type MailMessage, Mailer } from '../../kernel/mail/mailer.js';
import { type Bilingual, renderEmail } from '../../kernel/mail/template.js';

/** What happened to an online order; each event has its own wording. */
export type OrderEvent =
  | 'placed'
  | 'confirmed'
  | 'paid'
  | 'preparing'
  | 'ready'
  | 'out_for_delivery'
  | 'completed'
  | 'cancelled';

type Row = Record<string, unknown>;
type OrderMail = {
  number: string;
  fulfillment: string;
  paymentMode: string;
  customerName: string;
  customerEmail: string | null;
  deliveryAddress: string | null;
  deliveryAreaName: string | null;
  deliveryAreaNameEn: string | null;
  scheduledFor: Date | null;
  totalMinor: bigint;
  paid: boolean;
  trackingToken: string;
  lineCount: number;
  storeSlug: string;
  storeName: string;
  storeEmail: string | null;
  notifyMerchant: boolean;
  branchName: string | null;
  branchAddress: string | null;
  branchPhone: string | null;
  timezone: string;
};

const kwd = (minor: bigint) => `${Money.ofMinor(minor, 'KWD').toDecimalString()} KWD`;
const when = (d: Date, tz: string) =>
  new Intl.DateTimeFormat('en-GB', {
    timeZone: tz,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
    .format(d)
    .replace(',', '');

/**
 * E-mails about an online order (ADR-0123): to the shopper on every step, to the store's
 * contact address when a new order needs its attention. Sent after the order's transaction
 * committed, in the background; `drain()` waits for them in tests. A failed e-mail is logged,
 * never surfaced to the shopper or the staff.
 */
@Injectable()
export class OrderNotificationsService {
  private readonly logger = new Logger(OrderNotificationsService.name);
  private readonly pending = new Set<Promise<void>>();

  constructor(
    private readonly database: DatabaseService,
    private readonly mailer: Mailer,
    private readonly addresses: StoreAddressService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  notify(merchantId: string, orderId: string, event: OrderEvent): void {
    const job: Promise<void> = this.send(merchantId, orderId, event)
      .catch((error: unknown) =>
        this.logger.error(`Order ${orderId} ${event} e-mail failed: ${(error as Error).message}`),
      )
      .finally(() => this.pending.delete(job));
    this.pending.add(job);
  }

  async drain(): Promise<void> {
    await Promise.all([...this.pending]);
  }

  private async send(merchantId: string, orderId: string, event: OrderEvent) {
    const order = await this.database.withMerchantTx(merchantId, async (tx) => {
      const [o] = (
        await tx.execute(sql`
          select o.number, o.fulfillment, o.payment_mode, o.customer_name, o.customer_email, o.delivery_address,
                 coalesce(da.name_ar, o.delivery_area_name) as delivery_area_name,
                 coalesce(da.name_en, o.delivery_area_name) as delivery_area_name_en, o.scheduled_for, o.total_minor::text, o.sale_id, o.tracking_token,
                 (select count(*)::int from online_order_lines l where l.order_id = o.id) as line_count,
                 st.slug, st.name_ar, st.name_en, st.contact_email, st.notify_email,
                 b.name_ar as b_ar, b.name_en as b_en, b.address as b_address, b.phone as b_phone, m.timezone
          from online_orders o join online_stores st on st.merchant_id = o.merchant_id
          join branches b on b.id = o.branch_id join merchants m on m.id = o.merchant_id
          left join online_delivery_areas da on da.id = o.delivery_area_id
          where o.id = ${orderId}`)
      ).rows as Row[];
      if (!o) return null;
      const str = (v: unknown) => (v as string | null) ?? null;
      const mail: OrderMail = {
        number: o['number'] as string,
        fulfillment: o['fulfillment'] as string,
        paymentMode: o['payment_mode'] as string,
        customerName: o['customer_name'] as string,
        customerEmail: str(o['customer_email']),
        deliveryAddress: str(o['delivery_address']),
        deliveryAreaName: str(o['delivery_area_name']),
        deliveryAreaNameEn: str(o['delivery_area_name_en']),
        scheduledFor: o['scheduled_for'] ? new Date(o['scheduled_for'] as string) : null,
        totalMinor: BigInt(o['total_minor'] as string),
        paid: o['sale_id'] !== null,
        trackingToken: o['tracking_token'] as string,
        lineCount: o['line_count'] as number,
        storeSlug: o['slug'] as string,
        storeName: (str(o['name_ar']) ?? str(o['name_en']) ?? '') as string,
        storeEmail: str(o['contact_email']),
        notifyMerchant: Boolean(o['notify_email']),
        branchName: str(o['b_ar']) ?? str(o['b_en']),
        branchAddress: str(o['b_address']),
        branchPhone: str(o['b_phone']),
        timezone: o['timezone'] as string,
      };
      return mail;
    });
    if (!order) return;
    const storeUrl = await this.addresses.of(order.storeSlug);
    for (const message of this.messages(order, event, storeUrl)) {
      try {
        await this.mailer.send(message);
      } catch (error) {
        this.logger.error(`E-mail to ${message.to} failed: ${(error as Error).message}`);
      }
    }
  }

  private trackingUrl(order: OrderMail, storeUrl: string) {
    return `${storeUrl}/orders/${order.trackingToken}`;
  }

  private consoleUrl() {
    return `${this.env.PUBLIC_STORE_URL.replace(/\/store\/?$/, '')}/online/orders`;
  }

  /** The e-mails one event produces (shopper first, then the store when it should hear). */
  messages(
    order: OrderMail,
    event: OrderEvent,
    storeUrl = storeAddress(this.env, order.storeSlug),
  ): MailMessage[] {
    const out: MailMessage[] = [];
    const pickup = order.fulfillment === 'pickup';
    const total = kwd(order.totalMinor);
    const schedule = order.scheduledFor
      ? {
          ar: `الموعد المطلوب: ${when(order.scheduledFor, order.timezone)}.`,
          en: `Requested time: ${when(order.scheduledFor, order.timezone)}.`,
        }
      : { ar: '', en: '' };
    const where = pickup
      ? {
          ar: `الاستلام من: ${[order.branchName, order.branchAddress, order.branchPhone].filter(Boolean).join('، ')}.`,
          en: `Pickup at: ${[order.branchName, order.branchAddress, order.branchPhone].filter(Boolean).join(', ')}.`,
        }
      : {
          ar: `التوصيل إلى: ${[order.deliveryAreaName, order.deliveryAddress].filter(Boolean).join('، ')}.`,
          en: `Delivery to: ${[order.deliveryAreaNameEn, order.deliveryAddress].filter(Boolean).join(', ')}.`,
        };
    const pay = order.paid
      ? { ar: 'المبلغ مدفوع.', en: 'Paid.' }
      : order.paymentMode === 'on_receipt'
        ? {
            ar: `المبلغ ${total} يُدفع عند ${pickup ? 'الاستلام' : 'التوصيل'}.`,
            en: `${total} is paid on ${pickup ? 'pickup' : 'delivery'}.`,
          }
        : { ar: `المبلغ ${total}.`, en: `Amount ${total}.` };
    const shopper: Record<OrderEvent, { title: Bilingual; intro: Bilingual } | null> = {
      placed: {
        title: { ar: `استلمنا طلبك ${order.number}`, en: `Order ${order.number} received` },
        intro: {
          ar: `استلم ${order.storeName} طلبك (${order.lineCount} صنف، ${total}). سنؤكده قريبًا.\n${where.ar}\n${schedule.ar}\n${pay.ar}`,
          en: `${order.storeName} received your order (${order.lineCount} items, ${total}). We will confirm it shortly.\n${where.en}\n${schedule.en}\n${pay.en}`,
        },
      },
      confirmed: {
        title: { ar: `تم تأكيد طلبك ${order.number}`, en: `Order ${order.number} confirmed` },
        intro: {
          ar: `أكّد ${order.storeName} طلبك وبدأ العمل عليه.\n${where.ar}\n${schedule.ar}\n${pay.ar}`,
          en: `${order.storeName} confirmed your order and is working on it.\n${where.en}\n${schedule.en}\n${pay.en}`,
        },
      },
      paid: {
        title: {
          ar: `تم استلام دفعتك لطلب ${order.number}`,
          en: `Payment received for order ${order.number}`,
        },
        intro: {
          ar: `استلم ${order.storeName} دفعتك (${total}) لطلبك.\n${where.ar}\n${schedule.ar}`,
          en: `${order.storeName} received your payment (${total}) for your order.\n${where.en}\n${schedule.en}`,
        },
      },
      preparing: null,
      ready: {
        title: {
          ar: `طلبك ${order.number} جاهز للاستلام`,
          en: `Order ${order.number} is ready for pickup`,
        },
        intro: {
          ar: `طلبك جاهز.\n${where.ar}\n${pay.ar}`,
          en: `Your order is ready.\n${where.en}\n${pay.en}`,
        },
      },
      out_for_delivery: {
        title: { ar: `طلبك ${order.number} في الطريق`, en: `Order ${order.number} is on its way` },
        intro: {
          ar: `خرج طلبك للتوصيل.\n${where.ar}\n${pay.ar}`,
          en: `Your order is out for delivery.\n${where.en}\n${pay.en}`,
        },
      },
      completed: {
        title: { ar: `اكتمل طلبك ${order.number}`, en: `Order ${order.number} completed` },
        intro: {
          ar: `شكرًا لك! اكتمل طلبك من ${order.storeName}.`,
          en: `Thank you! Your order from ${order.storeName} is complete.`,
        },
      },
      cancelled: {
        title: { ar: `أُلغي طلبك ${order.number}`, en: `Order ${order.number} cancelled` },
        intro: {
          ar: `أُلغي طلبك من ${order.storeName}. إن كان لديك سؤال فتواصل مع المتجر.`,
          en: `Your order from ${order.storeName} was cancelled. Contact the store if you have a question.`,
        },
      },
    };
    const s = shopper[event];
    if (s && order.customerEmail)
      out.push({
        to: order.customerEmail,
        ...renderEmail({
          title: s.title,
          name: order.customerName,
          intro: s.intro,
          action: {
            label: { ar: 'متابعة الطلب', en: 'Track your order' },
            url: this.trackingUrl(order, storeUrl),
          },
        }),
      });
    // The store hears about work that needs it: a new pay-on-receipt order, or a paid one.
    const merchantEvent =
      event === 'placed' || (event === 'paid' && order.paymentMode === 'gateway');
    if (merchantEvent && order.notifyMerchant && order.storeEmail)
      out.push({
        to: order.storeEmail,
        ...renderEmail({
          title: { ar: `طلب جديد ${order.number}`, en: `New order ${order.number}` },
          name: order.storeName,
          intro: {
            ar: `طلب ${pickup ? 'استلام' : 'توصيل'} جديد من ${order.customerName} (${order.lineCount} صنف، ${total}).\n${where.ar}\n${schedule.ar}\n${pay.ar}`,
            en: `New ${pickup ? 'pickup' : 'delivery'} order from ${order.customerName} (${order.lineCount} items, ${total}).\n${where.en}\n${schedule.en}\n${pay.en}`,
          },
          action: { label: { ar: 'فتح الطلبات', en: 'Open the orders' }, url: this.consoleUrl() },
        }),
      });
    return out;
  }
}
