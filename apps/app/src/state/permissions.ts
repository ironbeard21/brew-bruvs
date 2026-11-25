// SPDX-License-Identifier: AGPL-3.0-or-later
// Client-side mirrors of apps/server/src/permissions.ts for hiding unavailable UI controls.
// The server always enforces every rule regardless of what the UI displays.
import type { Brewery, BreweryRole, ResourceOwner } from "../api/breweries";

export type Action = "read" | "contribute" | "edit" | "delete" | "share";

export const BREWERY_ROLES: readonly BreweryRole[] = ["owner", "brewer", "member", "viewer"];

export const ROLE_LABELS: Record<BreweryRole, string> = {
  owner: "Owner",
  brewer: "Brewer",
  member: "Member",
  viewer: "Viewer",
};

export const ROLE_DESCRIPTIONS: Record<BreweryRole, string> = {
  owner: "Full control: members, invites, deleting items, sharing, and brewery settings.",
  brewer: "Create and edit brewery recipes, batches, reminders, readings, and notes.",
  member: "Log readings and notes on brewery batches; read-only on recipes and settings.",
  viewer: "Read-only access to brewery recipes, batches, inventory, and members.",
};

const ROLE_ACTIONS: Record<BreweryRole, readonly Action[]> = {
  owner: ["read", "contribute", "edit", "delete", "share"],
  brewer: ["read", "contribute", "edit"],
  member: ["read", "contribute"],
  viewer: ["read"],
};

export function roleCan(role: BreweryRole | null | undefined, action: Action): boolean {
  if (!role) return false;
  return ROLE_ACTIONS[role].includes(action);
}

/** Owners and brewers can create or edit brewery-owned recipes, batches, and inventory. */
export function canWriteBrewery(role: BreweryRole | null | undefined): boolean {
  return roleCan(role, "edit");
}

/** Only brewery owners can rename/delete a brewery, manage members, or manage invites. */
export function canManageBrewery(role: BreweryRole | null | undefined): boolean {
  return role === "owner";
}

/** Owners, brewers, and members can contribute readings and notes to brewery batches. */
export function canContributeBrewery(role: BreweryRole | null | undefined): boolean {
  return roleCan(role, "contribute");
}

export function canPerformOnOwner(
  userId: string | null | undefined,
  breweries: readonly Pick<Brewery, "id" | "role">[],
  owner: ResourceOwner,
  action: Action,
): boolean {
  if (!userId) return false;
  if (owner.type === "user") {
    return owner.id === userId;
  }
  const membership = breweries.find((b) => b.id === owner.id);
  return roleCan(membership?.role, action);
}

export function formatOwnerLabel(
  owner: ResourceOwner,
  userId: string | null | undefined,
  breweries: readonly Pick<Brewery, "id" | "name">[],
): { label: string; isBrewery: boolean; isPersonal: boolean } {
  if (owner.type === "brewery") {
    const found = breweries.find((b) => b.id === owner.id);
    return {
      label: found ? found.name : "Brewery",
      isBrewery: true,
      isPersonal: false,
    };
  }
  if (userId && owner.id === userId) {
    return { label: "Mine", isBrewery: false, isPersonal: true };
  }
  return { label: "Shared", isBrewery: false, isPersonal: false };
}
