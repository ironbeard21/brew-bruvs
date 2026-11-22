// SPDX-License-Identifier: AGPL-3.0-or-later
import { units } from "@brew-bruvs/brew-math";
import { SaxesParser } from "saxes";
import type { RecipeContent } from "../contracts/recipe-content.ts";
import type { RecipeFile } from "../contracts/recipe-file.ts";
import {
  type FileStyle,
  fileCredit,
  invalidFile,
  parseRecipe,
  restoreRecipe,
  styleCode,
  writeExtras,
} from "./recipe-file.ts";

type Element = { tag: string; text: string; children: Element[] };
type Fields = { [tag: string]: string | number | boolean | undefined | Fields | Fields[] };

function parseXml(source: string): Element {
  const parser = new SaxesParser();
  const stack: Element[] = [];
  let root: Element | undefined;
  parser.on("doctype", () => invalidFile("BeerXML document types are not supported"));
  parser.on("error", () => invalidFile("Invalid BeerXML syntax"));
  parser.on("opentag", ({ name }) => {
    if (stack.length >= 32) invalidFile("BeerXML is nested too deeply");
    const node = { tag: name, text: "", children: [] };
    const parent = stack.at(-1);
    if (parent) parent.children.push(node);
    else root = node;
    stack.push(node);
  });
  const addText = (text: string) => {
    const node = stack.at(-1);
    if (node) node.text += text;
  };
  parser.on("text", addText);
  parser.on("cdata", addText);
  parser.on("closetag", () => {
    const node = stack.pop();
    if (node) node.text = node.text.trim();
  });
  parser.write(source).close();
  if (!root) invalidFile("Expected a BeerXML recipe");
  return root;
}

const child = (node: Element | undefined, tag: string) =>
  node?.children.find((item) => item.tag === tag);
const field = (node: Element | undefined, tag: string) => child(node, tag)?.text || undefined;
const rows = (node: Element | undefined, group: string, tag: string) =>
  child(node, group)?.children.filter((item) => item.tag === tag) ?? [];
const lower = (node: Element | undefined, tag: string) => field(node, tag)?.toLowerCase();

function number(node: Element | undefined, tag: string) {
  const raw = field(node, tag);
  if (raw === undefined) return undefined;
  const value = Number(raw);
  if (!Number.isFinite(value)) invalidFile(`Invalid BeerXML number in ${tag}`);
  return value;
}

function fromXmlRecipe(root: Element): RecipeFile {
  const type = lower(root, "TYPE");
  const styleType = lower(child(root, "STYLE"), "TYPE");
  const beverage =
    lower(root, "BREW_BRUVS_BEVERAGE") ??
    [styleType, type].find((value) => value === "cider" || value === "wine" || value === "mead") ??
    "beer";
  const color = number(root, "COLOR");
  const targets = {
    og: number(root, "OG"),
    fg: number(root, "FG"),
    abvPct: number(root, "ABV"),
    ibu: number(root, "IBU"),
    carbonationVols: number(root, "CARBONATION"),
    colorEbc: color === undefined ? undefined : units.srmToEbc(color),
  };
  const credit = fileCredit(field(root, "BREWER"), field(root, "BREW_BRUVS_SOURCE_URL"));
  return parseRecipe({
    name: field(root, "NAME"),
    beverage,
    batchSizeL: number(root, "BATCH_SIZE"),
    credit,
    content: {
      schemaVersion: 1,
      efficiencyPct: number(root, "EFFICIENCY") || undefined,
      boilTimeMin: number(root, "BOIL_TIME"),
      notes: field(root, "NOTES"),
      targets: Object.values(targets).some((value) => value !== undefined) ? targets : undefined,
      fermentables: rows(root, "FERMENTABLES", "FERMENTABLE").map((line) => {
        const type = lower(line, "TYPE");
        const kind =
          (
            {
              grain: "grain",
              sugar: "sugar",
              extract: "extract",
              "dry extract": "extract",
              adjunct: "adjunct",
              honey: "honey",
              fruit: "fruit",
              juice: "juice",
            } as Record<string, string>
          )[type ?? ""] ?? "other";
        const color = number(line, "COLOR");
        const volume = number(line, "BREW_BRUVS_VOLUME_L");
        return {
          name: field(line, "NAME"),
          kind,
          ...(volume === undefined ? { amountKg: number(line, "AMOUNT") } : { amountL: volume }),
          yieldPct: number(line, "YIELD"),
          potentialSg: number(line, "POTENTIAL"),
          colorEbc:
            color === undefined
              ? undefined
              : Math.max(0, units.srmToEbc(units.lovibondToSrm(color))),
          use:
            lower(line, "ADD_AFTER_BOIL") === "true"
              ? "fermentation"
              : kind === "grain"
                ? "mash"
                : "boil",
          note: field(line, "NOTES"),
        };
      }),
      hops: rows(root, "HOPS", "HOP").map((line) => {
        const use =
          (
            {
              boil: "boil",
              "first wort": "first_wort",
              mash: "mash",
              aroma: "whirlpool",
              "dry hop": "dry_hop",
            } as Record<string, string>
          )[lower(line, "USE") ?? ""] ?? "boil";
        const time = number(line, "TIME");
        const form = lower(line, "FORM");
        return {
          name: field(line, "NAME"),
          use,
          amountKg: number(line, "AMOUNT"),
          form: form && ["pellet", "leaf", "plug", "extract"].includes(form) ? form : undefined,
          alphaAcidPct: number(line, "ALPHA"),
          timeMin: use === "dry_hop" ? undefined : time,
          days: use === "dry_hop" && time !== undefined ? units.minutesToDays(time) : undefined,
          note: field(line, "NOTES"),
        };
      }),
      yeasts: rows(root, "YEASTS", "YEAST").map((line) => {
        const amount = number(line, "AMOUNT");
        const form = lower(line, "FORM");
        return {
          name: field(line, "NAME"),
          form:
            form === "dry" || form === "liquid" || form === "slurry"
              ? form
              : form
                ? "culture"
                : undefined,
          ...(amount
            ? lower(line, "AMOUNT_IS_WEIGHT") === "true"
              ? { amountKg: amount }
              : { amountL: amount }
            : {}),
          packs: number(line, "BREW_BRUVS_PACKS"),
          attenuationPct: number(line, "ATTENUATION"),
          note: field(line, "NOTES"),
        };
      }),
      miscs: [
        ...rows(root, "MISCS", "MISC").map((line) => {
          const kind =
            (
              {
                spice: "spice",
                herb: "herb",
                flavor: "flavor",
                fining: "fining",
                "water agent": "water_agent",
                nutrient: "nutrient",
                sulfite: "sulfite",
                acid: "acid",
                enzyme: "enzyme",
                tannin: "tannin",
                stabilizer: "stabilizer",
                oak: "oak",
              } as Record<string, string>
            )[lower(line, "TYPE") ?? ""] ?? "other";
          const use =
            (
              {
                boil: "boil",
                mash: "mash",
                primary: "primary",
                secondary: "secondary",
                bottling: "bottling",
              } as Record<string, string>
            )[lower(line, "USE") ?? ""] ?? "primary";
          const amount = number(line, "AMOUNT");
          const count = number(line, "BREW_BRUVS_COUNT");
          return {
            name: field(line, "NAME"),
            kind,
            use,
            ...(count !== undefined
              ? { count }
              : lower(line, "AMOUNT_IS_WEIGHT") === "true"
                ? { amountKg: amount }
                : { amountL: amount }),
            timeMin: use === "boil" || use === "mash" ? number(line, "TIME") : undefined,
            note: field(line, "NOTES"),
          };
        }),
        ...rows(root, "WATERS", "WATER").map((line) => ({
          name: field(line, "NAME"),
          kind: "water_agent",
          use: "mash",
          amountL: number(line, "AMOUNT"),
        })),
      ],
      mash: rows(child(root, "MASH"), "MASH_STEPS", "MASH_STEP").map((step) => ({
        name: field(step, "NAME"),
        type: lower(step, "TYPE"),
        tempC: number(step, "STEP_TEMP"),
        timeMin: number(step, "STEP_TIME"),
        infuseL: number(step, "INFUSE_AMOUNT") || undefined,
      })),
      fermentation: [
        ["PRIMARY", "primary", "Primary fermentation"],
        ["SECONDARY", "secondary", "Secondary fermentation"],
        ["TERTIARY", "conditioning", "Conditioning"],
        ["", "bottle_aging", "Bottle aging"],
      ].flatMap(([prefix, stage, name]) => {
        const start = prefix ? `${prefix}_` : "";
        const days = number(root, `${start}AGE`);
        const tempC = number(root, `${start}${prefix ? "TEMP" : "AGE_TEMP"}`);
        return days === undefined && tempC === undefined ? [] : [{ name, stage, days, tempC }];
      }),
    },
  });
}

export function importBeerXml(source: string) {
  const root = parseXml(source);
  const recipes =
    root.tag === "RECIPES" ? root.children.filter((node) => node.tag === "RECIPE") : [root];
  const [recipe] = recipes;
  if (
    recipes.length !== 1 ||
    !recipe ||
    recipe.tag !== "RECIPE" ||
    number(recipe, "VERSION") !== 1
  ) {
    invalidFile("Expected a BeerXML 1.0 document with exactly one recipe");
  }
  const extraText = field(recipe, "BREW_BRUVS_CONTENT");
  recipe.children = recipe.children.filter((element) => element.tag !== "BREW_BRUVS_CONTENT");
  return restoreRecipe(recipe, extraText, () => fromXmlRecipe(recipe));
}

function escapeXml(text: string) {
  const valid = Array.from(text, (character) => {
    const code = character.codePointAt(0) ?? 0;
    if (
      code === 9 ||
      code === 10 ||
      code === 13 ||
      (code >= 32 && code <= 0xd7ff) ||
      (code >= 0xe000 && code <= 0xfffd) ||
      code >= 0x10000
    )
      return character;
    return "\uFFFD";
  }).join("");
  return valid.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}
const xml = (fields: Fields, depth = 0): string =>
  Object.entries(fields)
    .filter(([, value]) => value !== undefined)
    .map(([tag, value]) => {
      if (Array.isArray(value)) return value.map((item) => xml({ [tag]: item }, depth)).join("");
      const pad = "  ".repeat(depth);
      if (typeof value === "object") {
        const body = xml(value, depth + 1);
        return `${pad}<${tag}>\n${body}${pad}</${tag}>\n`;
      }
      const body = escapeXml(
        typeof value === "boolean" ? String(value).toUpperCase() : String(value),
      );
      return `${pad}<${tag}>${body}</${tag}>\n`;
    })
    .join("");
const title = (name: string) => name.charAt(0).toUpperCase() + name.slice(1);

function writeIngredients(content: RecipeContent, beverage: RecipeFile["beverage"]): Fields {
  return {
    FERMENTABLES: {
      FERMENTABLE: content.fermentables.map((line) => ({
        NAME: line.name,
        VERSION: 1,
        TYPE: ["grain", "sugar", "extract"].includes(line.kind) ? title(line.kind) : "Adjunct",
        AMOUNT: line.amountKg ?? 0,
        YIELD: line.yieldPct ?? 0,
        COLOR:
          line.colorEbc === undefined
            ? 0
            : Math.max(0, units.srmToLovibond(units.ebcToSrm(line.colorEbc))),
        ADD_AFTER_BOIL: line.use === "fermentation" || line.use === "package",
        POTENTIAL: line.potentialSg,
        NOTES: line.note,
        BREW_BRUVS_VOLUME_L: line.amountL,
      })),
    },
    HOPS: {
      HOP: content.hops.map((line) => ({
        NAME: line.name,
        VERSION: 1,
        AMOUNT: line.amountKg,
        ALPHA: line.alphaAcidPct ?? 0,
        FORM: line.form && title(line.form === "extract" ? "pellet" : line.form),
        USE: {
          mash: "Mash",
          first_wort: "First Wort",
          boil: "Boil",
          whirlpool: "Aroma",
          dry_hop: "Dry Hop",
        }[line.use],
        TIME:
          line.days === undefined || line.use !== "dry_hop"
            ? (line.timeMin ?? 0)
            : units.timeToMinutes(line.days, "day"),
        NOTES: line.note,
      })),
    },
    YEASTS: {
      YEAST: content.yeasts.map((line) => ({
        NAME: line.name,
        VERSION: 1,
        TYPE: beverage === "beer" ? "Ale" : "Wine",
        FORM: line.form === "culture" ? "Culture" : line.form ? title(line.form) : "Liquid",
        AMOUNT: line.amountKg ?? line.amountL ?? 0,
        AMOUNT_IS_WEIGHT: line.amountKg !== undefined,
        ATTENUATION: line.attenuationPct,
        NOTES: line.note,
        BREW_BRUVS_PACKS: line.packs,
      })),
    },
    MISCS: {
      MISC: content.miscs.map((line) => ({
        NAME: line.name,
        VERSION: 1,
        TYPE:
          line.kind === "water_agent"
            ? "Water Agent"
            : ["spice", "herb", "flavor", "fining"].includes(line.kind)
              ? title(line.kind)
              : "Other",
        USE: line.use === "bulk_aging" ? "Secondary" : title(line.use),
        TIME: line.timeMin ?? 0,
        AMOUNT: line.amountKg ?? line.amountL ?? 0,
        AMOUNT_IS_WEIGHT: line.amountKg !== undefined,
        BREW_BRUVS_COUNT: line.count,
        NOTES: line.note,
      })),
    },
  };
}

export function exportBeerXml(recipe: RecipeFile, style?: FileStyle): string {
  const { content, beverage } = recipe;
  const grain = content.mash.length > 0;
  const primary = content.fermentation.find((step) => step.stage === "primary");
  const secondary = content.fermentation.find((step) => step.stage === "secondary");
  const tertiary = content.fermentation.find(
    (step) => step.stage === "conditioning" || step.stage === "bulk_aging",
  );
  const aging = content.fermentation.find((step) => step.stage === "bottle_aging");
  const t = content.targets;
  const code = style && styleCode(style.styleId);
  const standard: Fields = {
    NAME: recipe.name,
    VERSION: 1,
    TYPE: grain ? "All Grain" : "Extract",
    STYLE: {
      NAME: style?.name ?? "Unspecified",
      CATEGORY: style?.category ?? "Unspecified",
      VERSION: 1,
      CATEGORY_NUMBER: code?.category ?? style?.styleId ?? "",
      STYLE_LETTER: code?.letter ?? "",
      STYLE_GUIDE: style?.styleGuide ?? "",
      TYPE: beverage === "beer" ? "Mixed" : beverage === "wine" ? "Mixed" : title(beverage),
      OG_MIN: style?.ogMin ?? t?.og ?? 1,
      OG_MAX: style?.ogMax ?? t?.og ?? 1,
      FG_MIN: style?.fgMin ?? t?.fg ?? 1,
      FG_MAX: style?.fgMax ?? t?.fg ?? 1,
      IBU_MIN: style?.ibuMin ?? t?.ibu ?? 0,
      IBU_MAX: style?.ibuMax ?? t?.ibu ?? 0,
      COLOR_MIN: units.ebcToSrm(style?.colorEbcMin ?? t?.colorEbc ?? 0),
      COLOR_MAX: units.ebcToSrm(style?.colorEbcMax ?? t?.colorEbc ?? 0),
    },
    BREWER: recipe.credit?.author ?? "",
    BATCH_SIZE: recipe.batchSizeL,
    BOIL_SIZE: recipe.batchSizeL,
    BOIL_TIME: content.boilTimeMin ?? 0,
    EFFICIENCY: content.efficiencyPct ?? (grain ? 0 : undefined),
    ...writeIngredients(content, beverage),
    WATERS: {},
    MASH: grain
      ? {
          NAME: "Mash",
          VERSION: 1,
          GRAIN_TEMP: 20,
          MASH_STEPS: {
            MASH_STEP: content.mash.map((step) => ({
              NAME: step.name,
              VERSION: 1,
              TYPE: title(step.type),
              INFUSE_AMOUNT: step.infuseL,
              STEP_TIME: step.timeMin,
              STEP_TEMP: step.tempC,
            })),
          },
        }
      : undefined,
    OG: t?.og,
    FG: t?.fg,
    IBU: t?.ibu,
    ABV: t?.abvPct,
    CARBONATION: t?.carbonationVols,
    COLOR: t?.colorEbc === undefined ? undefined : units.ebcToSrm(t.colorEbc),
    PRIMARY_AGE: primary?.days,
    PRIMARY_TEMP: primary?.tempC,
    SECONDARY_AGE: secondary?.days,
    SECONDARY_TEMP: secondary?.tempC,
    TERTIARY_AGE: tertiary?.days,
    TERTIARY_TEMP: tertiary?.tempC,
    AGE: aging?.days,
    AGE_TEMP: aging?.tempC,
    NOTES: content.notes,
    BREW_BRUVS_BEVERAGE: beverage,
    BREW_BRUVS_SOURCE_URL: recipe.credit?.sourceUrl ?? undefined,
  };
  const extra = writeExtras(parseXml(xml({ RECIPE: standard })), recipe);
  return `<?xml version="1.0" encoding="UTF-8"?>\n${xml({
    RECIPES: {
      RECIPE: {
        ...standard,
        BREW_BRUVS_CONTENT: extra,
      },
    },
  })}`;
}
