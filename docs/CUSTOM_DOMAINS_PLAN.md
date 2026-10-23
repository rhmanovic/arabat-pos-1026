# Custom domains for online stores — plan

Status: **phases 1–2 done** (ADR-0136, ADR-0137); buying domains through Arabat is dropped (owner, 2026-10-23: merchants buy their own). (2026-10-23, ADR-0135.) The store console already shows the screens
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

## Phase 1 — free sub-domain `{slug}.arabatapp.com` — **done (ADR-0136, 2026-10-23)**

- Cloudflare proxies a wildcard record `*.arabatapp.com` (free Universal certificate, SSL mode
  Full) to the existing load balancer; `www`, the bare domain and mail records stay DNS only.
- `STORE_DOMAIN=arabatapp.com`: the host names the store, the storefront runs at `/`, old
  `/store/{slug}` addresses answer 301 to the sub-domain, every store link (console, e-mails,
  payment return, link previews) uses `storeAddress`.
- Renaming the store address moves the sub-domain; the old one keeps answering (and moves to the
  new one) for the 90 days a former address resolves (ADR-0118).
- Phase 0's host-based resolution is in place for sub-domains; the `store_domains` table comes
  with phase 2.

## Phase 2 — the merchant connects a domain they bought — **done (ADR-0137, 2026-10-23)**

- Every store has a permanent code `st-xxxxxx` (`st-xxxxxx.arabatapp.com`, never changes).
- Console → Settings → Domain: the main address, the Arabat address, the permanent link; the
  merchant types the domain bought anywhere, adds `CNAME www → stores.arabatapp.com` (the bare
  domain: ALIAS / flattening or forwarding to `www.`), and the platform does the rest through
  Cloudflare for SaaS custom hostnames: checks, certificate, activation, main address, daily
  re-checks, release after 7 days without the record. Nobody at Arabat acts per merchant.
- One-time platform step (owner): enable Cloudflare for SaaS on `arabatapp.com`, fallback origin
  `stores.arabatapp.com` (record created 2026-10-23), API token in Secret Manager
  `cloudflare-api-token` (OPERATIONS.md). Until then the console says "coming soon".

## Phase 3 — buying domains through Arabat — **dropped**

Owner, 2026-10-23: merchants buy their domain themselves from any provider; Arabat gives them the
records. No registrar integration, no domain billing.

## Phase 4 — operations

- Dashboard in `/platform` for operators: every domain, its status, failures (not built).
- E-mail to the merchant when a domain starts or stops working (not built; the console shows it).
- Removing a domain: the custom hostnames are deleted, the store answers at its Arabat address
  again (built).
- Security: hostnames are unique across merchants; a hostname is only attached after its
  validation succeeds; API tokens for Cloudflare are least-privilege (Custom Hostnames on one
  zone; Registrar separately) and live in Secret Manager.

## Console

Settings → **Domain** tab (ADR-0137): the addresses (main, Arabat, permanent link) with copy;
"Your own domain": how-to, the domain field and "Connect"; once connected the status, three steps
(record found → certificate → working), the record to add, what the check found, the bare-domain
help, "Check now", "Make it the main address" / "Use the Arabat address instead", "Remove". The
status refreshes by itself every 30 seconds while waiting.

## Open questions for the owner

1. ~~Cloudflare in front of `arabatapp.com`?~~ Yes for store hosts (ADR-0136).
2. Charge for an own domain, or include it in a plan? (Today: free for every store; each costs
   two Cloudflare host names beyond the first 100, $0.10 each a month.)
