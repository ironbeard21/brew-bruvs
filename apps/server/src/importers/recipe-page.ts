// SPDX-License-Identifier: AGPL-3.0-or-later
import { units } from "@brew-bruvs/brew-math";
import { type DefaultTreeAdapterTypes, parse, parseFragment } from "parse5";
import type { RecipeContent } from "../contracts/recipe-content.ts";
import type { RecipeFile } from "../contracts/recipe-file.ts";
import { ApiError } from "../errors.ts";
import { importBeerJson } from "./beerjson.ts";
import { importBeerXml } from "./beerxml.ts";
import { parseRecipe } from "./recipe-file.ts";
import { invalidUrl } from "./remote-recipe.ts";

type Node = DefaultTreeAdapterTypes.Node;
type Element = DefaultTreeAdapterTypes.Element;
type RecordValue = Record<string, unknown>;

function* walk(root: Node) {
  const pending = [root];
  while (pending.length) {
    const node = pending.pop();
    if (!node) break;
    yield node;
    if ("childNodes" in node) {
      for (let i = node.childNodes.length - 1; i >= 0; i--) {
        const child = node.childNodes[i];
        if (child) pending.push(child);
      }
    }
  }
}

function text(root: Node) {
  const parts: string[] = [];
  for (const node of walk(root)) {
    if ("value" in node && node.nodeName === "#text") parts.push(node.value);
  }
  return parts.join("");
}

const attr = (node: Element, key: string) => node.attrs.find((a) => a.name === key)?.value;
const record = (value: unknown): RecordValue | undefined =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as RecordValue) : undefined;
const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : [value]);
const clean = (value: unknown) =>
  typeof value === "string"
    ? text(parseFragment(value.replace(/<\/?(?:br|p|li)\b[^>]*>/gi, " ")))
        .replace(/\s+/g, " ")
        .trim()
    : "";
const label = (value: unknown) => clean(typeof value === "string" ? value : record(value)?.name);
const types = (value: unknown) =>
  list(value).map((entry) =>
    typeof entry === "string" ? entry.replace(/^https?:\/\/schema\.org\//, "") : "",
  );
const { massToKg, volumeToLiters } = units;

function findRecipe(value: unknown) {
  const pending = list(value).slice().reverse();
  while (pending.length) {
    const node = record(pending.pop());
    if (!node) continue;
    if (types(node["@type"]).includes("Recipe")) return node;
    const graph = list(node["@graph"]);
    for (let i = graph.length - 1; i >= 0; i--) pending.push(graph[i]);
  }
}

const massUnits: Record<string, Parameters<typeof massToKg>[1]> = {
  kg: "kg",
  kilogram: "kg",
  g: "g",
  gram: "g",
  lb: "lb",
  pound: "lb",
  oz: "oz",
  ounce: "oz",
};
const volumeUnits: Record<string, Parameters<typeof volumeToLiters>[1]> = {
  l: "l",
  liter: "l",
  litre: "l",
  ml: "ml",
  milliliter: "ml",
  millilitre: "ml",
  gal: "gal",
  gallon: "gal",
  qt: "qt",
  quart: "qt",
  cup: "cup",
  tsp: "tsp",
  tbsp: "tbsp",
  "fl oz": "floz",
};

function quantity(value: string) {
  const match = /^(?:(\d+)\s+)?(\d+)\s*\/\s*(\d+)\s*|^(\d+(?:\.\d+)?|\.\d+)\s*/.exec(value);
  if (!match) return;
  const amount = match[4]
    ? Number(match[4])
    : Number(match[1] ?? 0) + Number(match[2]) / Number(match[3]);
  if (!Number.isFinite(amount) || amount <= 0) return;
  const rest = value.slice(match[0].length);
  const unit = /^(fl\s+oz|[a-z]+)\b\.?\s*/i.exec(rest);
  const key = unit?.[1]?.toLowerCase().replace(/s$/, "") ?? "";
  const mass = Object.hasOwn(massUnits, key) ? massUnits[key] : undefined;
  const volume = Object.hasOwn(volumeUnits, key) ? volumeUnits[key] : undefined;
  const name =
    mass || volume || key === "pack" || key === "packet"
      ? rest.slice(unit?.[0].length).trim()
      : rest.trim();

  if (mass) return { name, amountKg: massToKg(amount, mass) };
  if (volume) return { name, amountL: volumeToLiters(amount, volume) };
  if (key === "pack" || key === "packet") return { name, packs: amount };
}

function instructions(value: unknown) {
  const result = [];
  const pending = list(value).slice().reverse();
  while (pending.length) {
    const next = pending.pop();
    const item = record(next);
    if (types(item?.["@type"]).includes("HowToSection")) {
      const steps = list(item?.itemListElement);
      for (let i = steps.length - 1; i >= 0; i--) pending.push(steps[i]);
    } else {
      const step = clean(typeof next === "string" ? next : (item?.text ?? item?.name));
      if (step) result.push(step);
    }
  }
  return result;
}

function schemaRecipe(source: RecordValue, suppliedBatchSize: number | undefined): RecipeFile {
  const content: RecipeContent = {
    schemaVersion: 1,
    fermentables: [],
    hops: [],
    yeasts: [],
    miscs: [],
    mash: [],
    fermentation: [],
  };
  const review: string[] = [];
  for (const value of list(source.recipeIngredient)) {
    const line = clean(value);
    if (!line) continue;
    const parsed = quantity(line);
    const { name, amountKg, amountL, packs } = parsed ?? {};
    if (!name) {
      review.push(line);
      continue;
    }
    const kind = /\b(?:grain|malt|barley|wheat|oats?|rye)\b/i.test(name)
      ? "grain"
      : /\b(?:extract|dme|lme)\b/i.test(name)
        ? "extract"
        : /\bhoney\b/i.test(name)
          ? "honey"
          : /\b(?:sugar|dextrose)\b/i.test(name)
            ? "sugar"
            : /\b(?:juice|must)\b/i.test(name)
              ? "juice"
              : undefined;
    const boil = /\b(\d+(?:\.\d+)?)\s*(?:min(?:utes?)?)\s*(?:boil)?\)?$/i.exec(name);
    if (/\byeast\b/i.test(name)) {
      content.yeasts.push({ name: name.replace(/\s+yeast$/i, ""), amountKg, amountL, packs });
    } else if (amountKg && /\bhops?\b/i.test(name) && /\bdry[ -]hop\b/i.test(name)) {
      content.hops.push({
        name: name.split(/\s+hops?\b/i)[0] ?? name,
        amountKg,
        use: "dry_hop",
        note: line,
      });
    } else if (amountKg && /\bhops?\b/i.test(name) && boil) {
      content.hops.push({
        name: name.split(/\s+hops?\b/i)[0] ?? name,
        amountKg,
        use: "boil",
        timeMin: Number(boil[1]),
        note: line,
      });
    } else if (kind && (amountKg || amountL)) {
      content.fermentables.push({ name, kind, amountKg, amountL });
    } else {
      review.push(line);
    }
  }
  const steps = instructions(source.recipeInstructions);
  if (steps.length || review.length) {
    content.notes = [
      ...steps.map((step, index) => `${index + 1}. ${step}`),
      ...(review.length ? ["", "Ingredients to review", ...review] : []),
    ]
      .join("\n")
      .trim()
      .slice(0, 20_000);
  }
  const numericTargets = record(source.recipeTargets);
  if (numericTargets) {
    const { og, fg, ibu, abvPct, colorEbc, carbonationVols, ph, titratableAcidityGPerL } =
      numericTargets;
    const entries = Object.entries({
      og,
      fg,
      ibu,
      abvPct,
      colorEbc,
      carbonationVols,
      ph,
      titratableAcidityGPerL,
    }).filter(([, value]) => typeof value === "number");
    if (entries.length) content.targets = Object.fromEntries(entries);
  }
  const yieldL = list(source.recipeYield)
    .map((value) => quantity(clean(value))?.amountL)
    .find((value) => value !== undefined);
  const batchSizeL = suppliedBatchSize ?? yieldL;
  if (!batchSizeL) invalidUrl("Enter a batch size in litres to import this recipe");
  const category = list(source.recipeCategory).map(clean).join(" ");
  const beverage =
    (["mead", "cider", "wine"] as const).find((type) =>
      new RegExp(`\\b${type}\\b`, "i").test(category),
    ) ?? "beer";
  return parseRecipe({ name: label(source.name), batchSizeL, beverage, content });
}

function fileLink(elements: Element[], url: URL) {
  for (const node of elements) {
    if (node.tagName !== "a" && node.tagName !== "link") continue;
    const href = attr(node, "href");
    if (!href) continue;
    const target = URL.parse(href, url);
    const type = attr(node, "type")?.split(";")[0]?.trim().toLowerCase();
    const path = target?.pathname.toLowerCase() ?? "";
    const label = attr(node, "title") ?? text(node);
    if (
      type === "application/vnd.beerxml+xml" ||
      path.endsWith(".beerxml") ||
      (path.endsWith(".xml") && /\bbeerxml\b/i.test(label))
    ) {
      return { href, format: "beerxml" as const };
    }
    if (
      type === "application/vnd.beerjson+json" ||
      path.endsWith(".beerjson") ||
      (path.endsWith(".json") && /\bbeerjson\b/i.test(label))
    ) {
      return { href, format: "beerjson" as const };
    }
  }
}

// Brewer's Friend advertises the export by name even when the link has no filename.
function brewersFriendFile(elements: Element[], url: URL) {
  if (!["www.brewersfriend.com", "brewersfriend.com"].includes(url.hostname)) return;
  const anchor = elements.find((node) => {
    if (node.tagName !== "a" || !/\bbeerxml\b/i.test(text(node))) return false;
    const href = attr(node, "href");
    const target = href && URL.parse(href, url);
    return target && target.origin === url.origin && target.pathname !== url.pathname;
  });
  const href = anchor && attr(anchor, "href");
  if (href) return { href, format: "beerxml" as const };
}

export async function importRecipePage(
  page: { url: URL; body: string },
  attachment: (href: string) => Promise<string>,
  batchSizeL?: number,
) {
  const { url } = page;
  const elements = [...walk(parse(page.body, { scriptingEnabled: false }))].filter(
    (node): node is Element => "tagName" in node,
  );
  const meta = (key: string) => {
    const node = elements.find(
      (entry) =>
        entry.tagName === "meta" && (attr(entry, "property") ?? attr(entry, "name")) === key,
    );
    return node ? clean(attr(node, "content")) : "";
  };
  let source: RecordValue | undefined;
  for (const node of elements) {
    if (
      node.tagName !== "script" ||
      attr(node, "type")?.trim().toLowerCase() !== "application/ld+json"
    )
      continue;
    try {
      source = findRecipe(JSON.parse(text(node)));
    } catch (error) {
      if (!(error instanceof SyntaxError)) throw error;
    }
    if (source) break;
  }

  const link = fileLink(elements, url) ?? (!source ? brewersFriendFile(elements, url) : undefined);
  let recipe: RecipeFile | undefined;
  if (link) {
    try {
      const uploaded = await attachment(link.href);
      const { recipe: linked } =
        link.format === "beerxml" ? importBeerXml(uploaded) : importBeerJson(uploaded);
      // A file's top-level notes are its author's description; a URL import keeps only the
      // page excerpt (plus steps, which schema.org pages carry in their own notes).
      recipe = { ...linked, content: { ...linked.content, notes: undefined } };
    } catch (error) {
      if (!(error instanceof ApiError) || error.code !== "invalid_recipe_file" || !source)
        throw error;
    }
  }
  recipe ??= source && schemaRecipe(source, batchSizeL);
  if (!recipe) invalidUrl("No supported brewing recipe was found on this page");

  const licenseLink = elements.find((node) => attr(node, "rel")?.split(/\s+/).includes("license"));
  const licenseValue = list(source?.license)[0];
  const license = (
    clean(typeof licenseValue === "string" ? licenseValue : record(licenseValue)?.["@id"]) ||
    label(licenseValue) ||
    (licenseLink ? URL.parse(attr(licenseLink, "href") ?? "", url)?.href : "") ||
    recipe.credit?.license ||
    ""
  ).slice(0, 200);
  const site = (label(source?.publisher) || meta("og:site_name") || url.hostname).slice(0, 200);
  const author = (
    list(source?.author).map(label).filter(Boolean).join(", ") ||
    meta("author") ||
    recipe.credit?.author ||
    ""
  ).slice(0, 200);
  const excerpt = (clean(source?.description) || meta("description") || meta("og:description"))
    .slice(0, 240)
    .trimEnd();
  const notes = [
    ...(excerpt ? [`Source excerpt\n${excerpt}`] : []),
    ...(recipe.content.notes ? [recipe.content.notes] : []),
  ]
    .join("\n\n")
    .slice(0, 20_000);
  return {
    excerpt,
    recipe: parseRecipe({
      ...recipe,
      credit: {
        sourceUrl: url.href,
        site,
        ...(author && { author }),
        ...(license && { license }),
        publicSharingBlocked:
          (recipe.credit?.publicSharingBlocked ?? false) ||
          /all rights reserved|no redistribution/i.test(license),
      },
      content: { ...recipe.content, notes: notes || undefined },
    }),
  };
}
