# Competitor feature gaps

Quick scan (2026-10-20) of features common in well-known POS products that Arabat does not
have yet. Competitors looked at: Foodics, Rewaa, Marn, Sapaad, Square, Lightspeed, Toast,
Shopify POS, Loyverse, Odoo POS, Revel. "Missing" was checked against the code in
`apps/api/src/modules` and `docs/PROGRESS.md` on this date; a feature that exists only partly
is marked *(partial)*. This is a backlog of ideas, not confirmed requirements: each item needs
an owner decision before it enters `docs/ROADMAP.md`. Items 6, 7, 8, 44 and 128 re-checked on
2026-10-23.

## Customers and marketing
1. **Loyalty points** — earn/redeem points per sale (Foodics, Square, Loyverse).
2. **Loyalty tiers / stamp cards** — "10th coffee free", silver/gold levels.
3. **Gift cards** — sell, top up and redeem prepaid cards (physical or digital).
4. **Store credit / customer wallet** — balance kept on the customer, usable at the till.
5. **Customer accounts (sell on credit)** — "pay later" with credit limit and statement.
6. **Promotions engine** *(partial: online store only — order / category / product offers, ADR-0125; not at the till)* — buy X get Y, bundles, % off a category, minimum basket.
7. **Happy hour / scheduled prices** *(partial: product discounts with start / end dates for store and till, ADR-0133; no time-of-day or weekday prices)* — prices by time of day or day of week.
8. **Coupon codes** *(partial: online store only, ADR-0125; not at the till)* — single-use or campaign codes, at the till and online.
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
44. **Product import/export in bulk** *(partial: products and categories with prices in Excel, ADR-0132; no stock quantities)* — Excel import of products, stock and prices.
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

## Second pass (2026-10-20)

### Customers and marketing
73. **Referral program** — reward a customer who brings a friend.
74. **Paid membership / subscriptions** — monthly coffee plan, member prices.
75. **Prepaid packages** — "10 washes" or "5 sessions" sold up front, used over time.
76. **Customer app / white-label app** — the merchant's own branded ordering app.
77. **Abandoned cart reminders** — online store follows up unpaid carts.
78. **Reviews on the online store** — product ratings by buyers.
79. **Customer self sign-up at the till** — QR to join loyalty and give a phone number.
80. **Marketing consent and unsubscribe** — opt-in records per channel.

### Selling at the till
81. **Offline card payments queue** — card taken while the network is down, settled later.
82. **Rounding to cash denomination** — round cash totals to the nearest 5 fils.
83. **Age check prompt** — confirm ID for tobacco and similar items.
84. **Item notes and custom items** — sell an open "misc" item with a typed price.
85. **Price check mode** — scan to see price and stock without selling.
86. **Returns without receipt** — refund by search with a manager limit.
87. **Gift receipt** — receipt without prices.
88. **Receipt customisation** — logo, footer, promotions, QR on the receipt.
89. **Voice / photo product search** — find a product by camera image.
90. **Cash drawer counting by denomination** — count notes and coins on close.
91. **Cash recycler / smart safe integration** — counted cash machines.
92. **Order on behalf for another branch** — sell at one branch, deliver from another.
93. **Click & collect at the till** *(partial: online hand-over exists)* — reserve online, pay in store.
94. **Endless aisle** — sell an out-of-stock item from the warehouse to ship.

### Restaurant
95. **Floor plan designer** *(partial: areas/tables exist)* — drag tables on a map.
96. **Seat numbers** — order and split per seat.
97. **Bar tabs** — open a tab with a card held.
98. **Combo meals** — meal with choice of side and drink at a combo price.
99. **Item 86 / out-of-stock sync** — mark an item sold out everywhere, including aggregators.
100. **Prep time and kitchen timers** — ticket age, late alerts on the KDS.
101. **Kitchen performance report** — average prep time per station.
102. **Allergens and calories** — on the menu, the receipt and the online store.
103. **Digital menu board** — TV menu screens managed from the dashboard.
104. **Catering orders** — large future orders with deposits.
105. **Waiter handheld app** — order taking on a phone at the table.
106. **Pay at table** — card terminal or link brought to the table.

### Inventory and purchasing
107. **Supplier portal** — supplier sees and confirms POs online.
108. **Purchase approval workflow** — PO above a limit needs approval.
109. **Landed cost** — shipping and customs added to item cost.
110. **Consignment stock** — goods owned by the supplier until sold.
111. **Stock aging report** — slow and dead stock.
112. **ABC analysis** — items by value contribution.
113. **Bin / shelf locations** — where an item sits in the store or warehouse.
114. **Waste log for retail** — expiry and damage write-offs by reason.
115. **Product images by AI / auto descriptions** — generate catalog content.
116. **Barcode lookup from a global database** — fill product data from GTIN.
117. **Unit of measure conversion** — buy by carton, sell by piece.

### Employees
118. **Breaks tracking** — paid and unpaid breaks.
119. **Leave requests** — vacations and sick days.
120. **Overtime rules** — hours beyond the schedule.
121. **Tasks / checklists for staff** — opening and closing checklists.
122. **Employee self-service app** — see schedule and hours on the phone.
123. **Cashier training mode** — sell without affecting stock or reports.

### Finance and reporting
124. **Custom report builder** — choose columns, filters and grouping.
125. **Dashboards on TV / wall display** — live sales screen.
126. **Benchmarking** — compare with similar shops in the area.
127. **Hourly heatmap** — busy hours by day.
128. **Tax per item and multiple tax rates** (no tax at all yet; planned in ROADMAP M12) — mixed VAT rates on one sale.
129. **Expense categories with receipts photo** *(partial: disbursements exist)* — scan bills.
130. **Petty cash requests app** — staff request, owner approves on the phone.
131. **Bank feed import** — bank statement import for reconciliation.
132. **Multi-entity consolidation** — reports across several companies.

### Platform and operations
133. **Two-factor sign-in (2FA)** — code app or SMS for owners.
134. **Single sign-on (Google / Microsoft)** — sign in with an existing account.
135. **Data export / backup for the merchant** — download all data at any time.
136. **Sandbox / demo company** — try features with sample data.
137. **In-app help center and chat support** — help articles and live chat.
138. **Onboarding wizard by business type** *(partial: setup checklist exists)* — ready catalog templates.
139. **Status page** — public uptime page.
140. **Hardware management** — see each device's health and version remotely.
141. **Remote device lock / wipe** — lost tablet protection.
142. **Multi-language beyond ar/en** — Urdu, Hindi, Filipino staff interfaces.
