// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from "vitest";
import {
  type Action,
  type BreweryRole,
  can,
  type Resource,
  type User,
} from "../src/permissions.ts";

const ACTIONS: Action[] = ["read", "edit", "delete", "share"];

const alice: User = { id: "alice", memberships: [] };
const bob: User = { id: "bob", memberships: [] };
const member = (role: BreweryRole, breweryId = "hops-co"): User => ({
  id: `${role}-user`,
  memberships: [{ breweryId, role }],
});

const privateRecipe = (owner: Resource["owner"], shares: Resource["shares"] = []): Resource => ({
  owner,
  visibility: "private",
  shares,
});

const allowed = (user: User | null, resource: Resource) =>
  ACTIONS.filter((a) => can(user, a, resource));

describe("can: owner", () => {
  it("a user can do everything to what they own", () => {
    expect(allowed(alice, privateRecipe({ type: "user", id: "alice" }))).toEqual(ACTIONS);
  });

  it("another user can do nothing to a private item", () => {
    expect(allowed(bob, privateRecipe({ type: "user", id: "alice" }))).toEqual([]);
  });
});

describe("can: brewery role", () => {
  const breweryRecipe = privateRecipe({ type: "brewery", id: "hops-co" });

  it.each<[BreweryRole, Action[]]>([
    ["owner", ["read", "edit", "delete", "share"]],
    ["brewer", ["read", "edit"]],
    ["member", ["read"]],
    ["viewer", ["read"]],
  ])("%s gets %j", (role, expected) => {
    expect(allowed(member(role), breweryRecipe)).toEqual(expected);
  });

  it("a role in a different brewery grants nothing", () => {
    expect(allowed(member("owner", "other-co"), breweryRecipe)).toEqual([]);
  });
});

describe("can: explicit share", () => {
  const owner = { type: "user", id: "alice" } as const;

  it("a read share to a user grants read only", () => {
    const r = privateRecipe(owner, [{ to: { type: "user", id: "bob" }, level: "read" }]);
    expect(allowed(bob, r)).toEqual(["read"]);
  });

  it("an edit share to a user grants read and edit, never delete or share", () => {
    const r = privateRecipe(owner, [{ to: { type: "user", id: "bob" }, level: "edit" }]);
    expect(allowed(bob, r)).toEqual(["read", "edit"]);
  });

  it("a share to someone else grants nothing", () => {
    const r = privateRecipe(owner, [{ to: { type: "user", id: "carol" }, level: "edit" }]);
    expect(allowed(bob, r)).toEqual([]);
  });

  it("an edit share to a brewery lets its brewers edit", () => {
    const r = privateRecipe(owner, [{ to: { type: "brewery", id: "hops-co" }, level: "edit" }]);
    expect(allowed(member("brewer"), r)).toEqual(["read", "edit"]);
  });

  it.each<BreweryRole>(["member", "viewer"])(
    "an edit share to a brewery leaves its %ss read-only",
    (role) => {
      const r = privateRecipe(owner, [{ to: { type: "brewery", id: "hops-co" }, level: "edit" }]);
      expect(allowed(member(role), r)).toEqual(["read"]);
    },
  );

  it("a share to a brewery grants nothing to non-members", () => {
    const r = privateRecipe(owner, [{ to: { type: "brewery", id: "hops-co" }, level: "edit" }]);
    expect(allowed(bob, r)).toEqual([]);
  });
});

describe("can: visibility", () => {
  const withVisibility = (visibility: Resource["visibility"]): Resource => ({
    owner: { type: "user", id: "alice" },
    visibility,
    shares: [],
  });

  it("private: hidden from other users and anonymous visitors", () => {
    expect(allowed(bob, withVisibility("private"))).toEqual([]);
    expect(allowed(null, withVisibility("private"))).toEqual([]);
  });

  it("unlisted: anyone with the link can read, nobody else can change it", () => {
    expect(allowed(bob, withVisibility("unlisted"))).toEqual(["read"]);
    expect(allowed(null, withVisibility("unlisted"))).toEqual(["read"]);
  });

  it("server: any signed-in user can read, anonymous visitors cannot", () => {
    expect(allowed(bob, withVisibility("server"))).toEqual(["read"]);
    expect(allowed(null, withVisibility("server"))).toEqual([]);
  });

  it("public: anyone can read, nobody else can change it", () => {
    expect(allowed(bob, withVisibility("public"))).toEqual(["read"]);
    expect(allowed(null, withVisibility("public"))).toEqual(["read"]);
  });
});
