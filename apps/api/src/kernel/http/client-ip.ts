import { BlockList, isIPv4 } from 'node:net';

/*
 * The client's address behind Cloudflare (ADR-0136): store sub-domains are proxied by
 * Cloudflare, which adds its own hop in front of the load balancer. A hop from Cloudflare's
 * published ranges (https://api.cloudflare.com/client/v4/ips, 2026-10-23) is trusted like the
 * configured hops, so rate limits and the audit log see the shopper, not a Cloudflare server.
 * Only an address the load balancer saw itself can fall in these ranges: it cannot be faked.
 */
const CLOUDFLARE = new BlockList();
for (const cidr of [
  '173.245.48.0/20',
  '103.21.244.0/22',
  '103.22.200.0/22',
  '103.31.4.0/22',
  '141.101.64.0/18',
  '108.162.192.0/18',
  '190.93.240.0/20',
  '188.114.96.0/20',
  '197.234.240.0/22',
  '198.41.128.0/17',
  '162.158.0.0/15',
  '104.16.0.0/13',
  '104.24.0.0/14',
  '172.64.0.0/13',
  '131.0.72.0/22',
]) {
  const [net, bits] = cidr.split('/') as [string, string];
  CLOUDFLARE.addSubnet(net, Number(bits), 'ipv4');
}
for (const cidr of [
  '2400:cb00::/32',
  '2606:4700::/32',
  '2803:f800::/32',
  '2405:b500::/32',
  '2405:8100::/32',
  '2a06:98c0::/29',
  '2c0f:f248::/32',
]) {
  const [net, bits] = cidr.split('/') as [string, string];
  CLOUDFLARE.addSubnet(net, Number(bits), 'ipv6');
}

export function isCloudflareAddress(address: string): boolean {
  const plain = address.replace(/^::ffff:/i, '');
  try {
    return isIPv4(plain) ? CLOUDFLARE.check(plain, 'ipv4') : CLOUDFLARE.check(plain, 'ipv6');
  } catch {
    return false;
  }
}

/**
 * Fastify `trustProxy`: a hop count also trusts the Cloudflare hop behind those hops;
 * addresses and `false` are kept as they are.
 */
export function trustProxyOption(
  setting: false | number | string[],
): false | string[] | ((address: string, hop: number) => boolean) {
  if (typeof setting !== 'number') return setting;
  return (address, hop) => hop < setting || isCloudflareAddress(address);
}
