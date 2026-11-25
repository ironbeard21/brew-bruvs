// SPDX-License-Identifier: AGPL-3.0-or-later
// The one permission check every route uses: owner → brewery role → explicit share → visibility.

export type Action = "read" | "edit" | "delete" | "share";
export type BreweryRole = "owner" | "brewer" | "member" | "viewer";
// unlisted: anyone with the link can read it; lists and search leave it out.
export type Visibility = "private" | "unlisted" | "server" | "public";
export type ShareLevel = "read" | "edit";

export type Principal = { type: "user"; id: string } | { type: "brewery"; id: string };

export interface User {
  id: string;
  memberships: { breweryId: string; role: BreweryRole }[];
}

export interface Resource {
  owner: Principal | null;
  visibility: Visibility;
  shares: { to: Principal; level: ShareLevel }[];
}

const ROLE_ACTIONS: Record<BreweryRole, readonly Action[]> = {
  owner: ["read", "edit", "delete", "share"],
  brewer: ["read", "edit"],
  // Members log readings and notes on brewery batches: the "contribute" action, P2-03.
  member: ["read"],
  viewer: ["read"],
};

const SHARE_ACTIONS: Record<ShareLevel, readonly Action[]> = {
  read: ["read"],
  edit: ["read", "edit"],
};

/** `user` is null for an anonymous visitor. */
export function can(user: User | null, action: Action, resource: Resource): boolean {
  const { owner } = resource;

  if (user) {
    if (owner?.type === "user" && owner.id === user.id) return true;

    const roleOf = (breweryId: string) =>
      user.memberships.find((m) => m.breweryId === breweryId)?.role;

    if (owner?.type === "brewery") {
      const role = roleOf(owner.id);
      if (role && ROLE_ACTIONS[role].includes(action)) return true;
    }

    for (const share of resource.shares) {
      if (!SHARE_ACTIONS[share.level].includes(action)) continue;
      if (share.to.type === "user" && share.to.id === user.id) return true;
      if (share.to.type === "brewery") {
        const role = roleOf(share.to.id);
        // A brewery's members and viewers stay read-only even when the share grants edit.
        if (role && (action === "read" || role === "owner" || role === "brewer")) return true;
      }
    }
  }

  if (action !== "read") return false;
  if (resource.visibility === "public" || resource.visibility === "unlisted") return true;
  return resource.visibility === "server" && user !== null;
}
