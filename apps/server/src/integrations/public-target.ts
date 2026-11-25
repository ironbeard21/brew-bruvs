// SPDX-License-Identifier: AGPL-3.0-or-later
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import ipaddr from "ipaddr.js";

export type Address = { address: string; family: number };
export type Resolver = (host: string) => Promise<Address[]>;
export const systemResolve: Resolver = (host) => lookup(host, { all: true });
type Refuse = (message: string) => never;

export function publicWebUrl(input: string, refuse: Refuse, base?: URL) {
  const url = URL.parse(input, base);
  if (
    !url ||
    (url.protocol !== "http:" && url.protocol !== "https:") ||
    url.username ||
    url.password ||
    url.port ||
    url.href.length > 2_000
  ) {
    refuse("Use a public HTTP or HTTPS URL on its default port");
  }
  url.hash = "";
  return url;
}

export async function publicDestination(url: URL, resolve: Resolver, refuse: Refuse) {
  const host = url.hostname.replace(/^\[|\]$/g, "").replace(/\.$/, "");
  const family = isIP(host);
  if (
    (!host.includes(".") && !family) ||
    /(?:^|\.)(?:localhost|local|internal|home\.arpa)$/i.test(host)
  ) {
    refuse("Use a public destination");
  }
  const addresses = family ? [{ address: host, family }] : await resolve(host);
  const first = addresses[0];
  if (
    !first ||
    !addresses.every(({ address }) => {
      const ip = ipaddr.parse(address);
      // IPv6 destinations must also be in globally routed space.
      return ip.range() === "unicast" && (ip.kind() === "ipv4" || /^[23]/.test(address));
    })
  )
    refuse("Use a public destination");
  return first;
}
