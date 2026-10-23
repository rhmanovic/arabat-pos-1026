# Custom domains for online stores — plan

Status: **plan only** (2026-10-23, ADR-0135). The store console already shows the screens
(Settings → Domain), disabled. Nothing below is built yet; each phase needs the owner's go-ahead,
and anything that costs money (Cloudflare plans, domain purchases) needs explicit approval
(CLAUDE.md §3.13).

## Goal

A merchant can:

1. use a free sub-domain `{slug}.arabatapp.com`;
2. connect a domain they already own (`www.their-store.com`);
3. search for a new domain, see whether it is available and its yearly price, and buy it through
   Arabat, registered through Cloudflare;
4. see, at every moment, where the domain stands (DNS, verification, certificate, live) and be
   told when something breaks or a renewal is due.

## What exists today

- Stores are served at `https://www.arabatapp.com/store/{slug}` by the API (`SERVE_WEB`), with
  link-preview tags (ADR-0134).
- The storefront router (`apps/store-web`) expects the `/store/{slug}` prefix.
- Production runs on Cloud Run in Doha (ADR-0105). How `www.arabatapp.com` reaches Cloud Run
  (Cloud Run domain mapping, a load balancer, or Cloudflare in front) decides the shape of
  phase 1 and must be checked first.

## Phase 0 — foundations (no merchant-visible change)

- **Host-based store resolution.** A request whose `Host` is not Arabat's own is looked up in
  `store_domains`; the store page is then served at `/` (not `/store/{slug}`). The storefront
  learns its base from a value injected into `index.html` (as the link-preview tags are), so the
  router's basename becomes `/` on a custom domain and `/store/{slug}` otherwise. API calls stay
  same-origin (`/api/v1/store/{slug}/…`); cookies are not used by the store (bearer tokens), so
  no cookie domain work is needed.
- **Table `store_domains`** (merchant, store, `hostname` unique across all merchants and
  lower-case, `kind` subdomain | connected | purchased, `status` pending_dns | verifying |
  issuing_certificate | active | failed | removed, `cloudflare_custom_hostname_id`,
  `verification` jsonb (records to show), `last_checked_at`, `last_error`, `is_primary`,
  timestamps; RLS). Status changes are audited.
- **One canonical address.** When a domain is active and primary, the old `/store/{slug}` address
  answers with a 301 to it, and the link-preview `og:url` / canonical use it.

## Phase 1 — free sub-domain `{slug}.arabatapp.com`

- Needs a wildcard DNS record `*.arabatapp.com` and a wildcard certificate in front of Cloud Run.
  Cloud Run domain mappings do not take wildcards: either a Google external HTTPS load balancer
  with a wildcard certificate, or Cloudflare proxying `arabatapp.com` (wildcard proxied record,
  Cloudflare edge certificate). Decision at the start of the phase, with costs.
- Renaming the store address moves the sub-domain; the old one redirects for 30 days.

## Phase 2 — connect a domain the merchant owns (Cloudflare for SaaS)

- Use **Cloudflare for SaaS / Custom Hostnames** on the `arabatapp.com` zone:
  - fallback origin `stores.arabatapp.com` → the production service;
  - the merchant adds `CNAME www → stores.arabatapp.com` (and, for the bare domain, the redirect
    their DNS host offers, or an ALIAS / CNAME-flattening record);
  - Arabat creates the custom hostname through the Cloudflare API
    (`POST /zones/{zone_id}/custom_hostnames`) with HTTP or TXT validation, shows the records to
    add (the console's table), and polls its `status` and `ssl.status` until `active`.
- "Check the connection" re-reads the hostname from Cloudflare and resolves the merchant's DNS
  to give a precise message (record missing, pointing elsewhere, waiting for the certificate).
- A scheduled job re-checks every domain daily and e-mails the merchant when one stops working.
- Costs to confirm with the owner before starting: Cloudflare for SaaS includes a number of
  custom hostnames on paid plans and charges per extra hostname per month (check current prices).

## Phase 3 — search and buy a domain

- **Availability and price:** a registrar API that answers availability and the yearly price for
  a name and ending (`.com`, `.store`, `.shop`, `.net`, `.co`, `.online`…). Cloudflare Registrar
  sells at cost, but registering new domains through its public API must be confirmed at the
  start of the phase (its API has long covered managing domains already in the account rather
  than buying new ones). If it is not available, use a registrar with a full purchase API and
  put the domain on Cloudflare DNS, or keep Cloudflare and buy from its dashboard by hand at
  first. This is the first thing to verify in this phase.
- **Who owns the domain:** registered with the merchant's details as the registrant (they own
  it), Arabat as the technical contact; documented in the terms of service.
- **Paying:** the merchant pays the yearly price (plus a margin, if the owner wants one) before
  the purchase; this needs a real payment gateway (see the payment gateways screens) or a manual
  invoice at first. Renewal reminders 30 / 7 / 1 days before expiry; auto-renew on by default
  with consent.
- After the purchase the domain is connected automatically (phase 2 flow, without any DNS work
  for the merchant because the zone is managed by Arabat).

## Phase 4 — operations

- Dashboard in `/platform` for operators: every domain, its status, failures, renewals.
- Removing a domain: the custom hostname is deleted, the store answers at its Arabat address
  again; a purchased domain stays the merchant's (transfer code on request).
- Security: hostnames are unique across merchants; a hostname is only attached after its
  validation succeeds; API tokens for Cloudflare are least-privilege (Custom Hostnames on one
  zone; Registrar separately) and live in Secret Manager.

## Console (already built, disabled)

Settings → **Domain** tab: current address with copy, the sub-domain line, "Buy a new domain"
(name, ending, availability results with yearly price, note on Cloudflare), "I already have a
domain" (domain field, DNS records table, "Check the connection"), and the steps
search → buy → connect → verify → certificate → live. Each control is wired to an API in the
phase that builds it.

## Open questions for the owner

1. Do we put Cloudflare in front of `arabatapp.com` (needed for phases 1–2 in the simplest form)?
2. Charge for the sub-domain / connected domain, or include them in a plan?
3. Margin on domain prices, and which endings to offer first (`.com`, `.store`, `.shop`…)?
