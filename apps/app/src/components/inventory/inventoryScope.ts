// SPDX-License-Identifier: AGPL-3.0-or-later
import type { Brewery, ResourceOwner } from "../../api/breweries";

export type InventoryTab = "stock" | "shopping";

/** Builds a route URL to /inventory scoped explicitly to a batch's owner ("me" or brewery id). */
export function buildBatchInventoryHref(owner: ResourceOwner, tab?: InventoryTab): string {
  const params = new URLSearchParams();
  if (tab) params.set("tab", tab);
  if (owner.type === "brewery") {
    params.set("breweryId", owner.id);
  } else {
    params.set("scope", "me");
  }
  return `/inventory?${params.toString()}`;
}

/** True when the signed-in user can view the inventory belonging to `owner`. */
export function canAccessOwnerInventory(
  owner: ResourceOwner,
  currentUserId: string | null | undefined,
  breweries: readonly Pick<Brewery, "id">[],
): boolean {
  if (!currentUserId) return false;
  if (owner.type === "user") return owner.id === currentUserId;
  return breweries.some((b) => b.id === owner.id);
}

/**
 * Resolves which brewery (or null for "Me") /inventory should display, prioritizing an explicit
 * route scope param on arrival until the user switches workspace manually.
 */
export function resolveInventoryBrewery(opts: {
  activeBrewery: Brewery | null;
  breweries: readonly Brewery[];
  paramBreweryId?: string | undefined;
  paramScope?: string | undefined;
  routeOverrideActive: boolean;
}): Brewery | null {
  if (opts.routeOverrideActive) {
    if (opts.paramScope === "me") return null;
    if (opts.paramBreweryId) {
      const matched = opts.breweries.find((b) => b.id === opts.paramBreweryId);
      if (matched) return matched;
    }
  }
  return opts.activeBrewery;
}
