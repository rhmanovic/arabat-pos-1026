# Competitor feature gaps

Quick scan (2026-10-20) of features common in well-known POS products that Arabat does not
have yet. Competitors looked at: Foodics, Rewaa, Marn, Sapaad, Square, Lightspeed, Toast,
Shopify POS, Loyverse, Odoo POS, Revel. "Missing" was checked against the code in
`apps/api/src/modules` and `docs/PROGRESS.md` on this date; a feature that exists only partly
is marked *(partial)*. This is a backlog of ideas, not confirmed requirements: each item needs
an owner decision before it enters `docs/ROADMAP.md`.

## Customers and marketing
1. **Loyalty points** — earn/redeem points per sale (Foodics, Square, Loyverse).
2. **Loyalty tiers / stamp cards** — "10th coffee free", silver/gold levels.
3. **Gift cards** — sell, top up and redeem prepaid cards (physical or digital).
4. **Store credit / customer wallet** — balance kept on the customer, usable at the till.
5. **Customer accounts (sell on credit)** — "pay later" with credit limit and statement.
6. **Promotions engine** — buy X get Y, bundles, % off a category, minimum basket.
7. **Happy hour / scheduled prices** — prices by time of day or day of week.
8. **Coupon codes** — single-use or campaign codes, at the till and online.
9. **SMS / WhatsApp campaigns** — marketing messages to customer segments.
10. **Digital receipts** — receipt by SMS / WhatsApp / e-mail with a link.
11. **Customer feedback** — rating link on the receipt.
12. **Customer segments / RFM** — top, lapsed and new customers lists.
13. **Birthday rewards** — automatic offer on the customer's birthday.

## Selling at the till
14. **Customer-facing display** — second screen showing cart and total.
15. **Price lists / wholesale prices** — different prices per customer group or branch.
16. **Quotations** — printable quote that converts to a sale.
17. **Layaway / deposits** — part payment now, goods collected later.
18. **Special orders / pre-orders** — order an item not in stock with a deposit.
19. **Weighing scale integration** — read weight from a scale; price-embedded barcodes.
20. **Barcode / shelf label printing** — print price labels from products and receipts of goods.
21. **Serial / IMEI tracking** — per-unit serials for electronics and warranty.
22. **Batch / lot and expiry dates** — FEFO, expiry alerts (pharmacy, grocery).
23. **Card terminal integration (KNET, softPOS / tap to pay)** — amount pushed to the terminal.
24. **Multi-currency cash** — accept USD/SAR at the till with an exchange rate.
25. **Tips** — tip on the bill and tip payout per employee.
26. **Service charge** — automatic % on dine-in bills.
27. **Fast cashier switch** *(partial: PIN sign-in exists)* — switch user without closing the till.
28. **Keyboard shortcuts / hotkeys page** — custom quick-buttons layout per branch.

## Restaurant
29. **Table reservations / waitlist** — bookings and queue with SMS.
30. **Courses and fire control** — starters / mains, "fire" each course.
31. **Kitchen printers** *(partial: KDS exists)* — tickets per station on a printer.
32. **QR table ordering** — guest scans, orders and pays from the table.
33. **Self-order kiosk** — customer orders on a kiosk screen.
34. **Delivery aggregators** — Talabat, Deliveroo, Jahez, Keeta orders into the POS (Foodics via Deliverect).
35. **Driver management** — assign own drivers, track delivery.
36. **Call-center ordering** — phone orders with caller history.
37. **Order-ready screen** — "your order is ready" number screen.
38. **Menu engineering report** — stars / dogs by margin and popularity.
39. **Recipe costing what-if** *(partial: recipes exist)* — theoretical vs. actual food cost.
40. **Ingredient production / prep batches** — make sauces from raw items.

## Inventory and purchasing
41. **Auto reorder suggestions** — purchase order drafted from min/max levels and sales speed.
42. **Supplier price lists** — supplier's catalogue and last price per supplier.
43. **Composite / bundle products** — a kit sold as one item, stock taken from parts.
44. **Product import/export in bulk** *(check)* — Excel import of products, stock and prices.
45. **Mobile stock counting app** — count with phone camera scanning.
46. **Demand forecasting** — predicted sales per item.
47. **Central kitchen / warehouse production** — production orders between branches.

## Employees
48. **Time clock / attendance** — clock in/out at the till.
49. **Shifts scheduling** — staff roster per branch.
50. **Sales commission** — commission per employee / item.
51. **Payroll export** — hours and commission to payroll.
52. **Employee performance report** — sales, voids, discounts per cashier.

## Finance and compliance
53. **E-invoicing / fiscal receipts** — e.g. ZATCA (KSA) QR and XML, per country.
54. **Accounting integration** — Xero, QuickBooks, Zoho Books, Qoyod, Daftra.
55. **Full general ledger / chart of accounts** — journal entries, P&L, balance sheet.
56. **Customer invoices (B2B)** — tax invoices with due dates and payments.
57. **Budget vs. actual** — sales targets per branch.

## Platform, apps and integrations
58. **Public API + webhooks for merchants** — third-party developers.
59. **App marketplace** — plug-in integrations (Foodics has 140+).
60. **Owner mobile app** — live sales and alerts on the phone (push notifications).
61. **Scheduled report e-mails** — daily summary sent automatically.
62. **Real-time alerts** — big refund, cash variance, low stock pushed to the owner.
63. **Franchise / multi-company view** — one owner over several companies.
64. **Hardware store** — sell bundled printers, drawers, tablets.
65. **Social / marketplace selling** — Instagram, Google, marketplace catalog sync.
66. **Payment links** — send a pay link by WhatsApp for remote orders.
67. **Built-in payments / payouts** — the POS company processes cards and pays out (Square, Foodics Pay).
68. **Merchant financing** — cash advances based on sales (Square Capital, Foodics Capital).

## Verticals
69. **Salon / service appointments** — bookings with staff and service duration.
70. **Pharmacy mode** — expiry, batches, prescriptions.
71. **Apparel matrix** *(partial: variants exist)* — size × colour grid entry and reports.
72. **Car wash / laundry tickets** — ticket in, collect later.
