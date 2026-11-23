// SPDX-License-Identifier: AGPL-3.0-or-later
import { Platform, Share } from "react-native";
import type { RecipeFileFormat } from "../../api/recipes";

/**
 * Infers BeerXML vs BeerJSON from a file name or raw file contents.
 */
export function detectRecipeFormat(
  filename?: string | null,
  contents?: string | null,
): RecipeFileFormat | null {
  const lower = (filename ?? "").trim().toLowerCase();
  if (lower.endsWith(".json") || lower.endsWith(".beerjson")) {
    return "beerjson";
  }
  if (lower.endsWith(".xml") || lower.endsWith(".beerxml")) {
    return "beerxml";
  }
  const trimmed = (contents ?? "").trim();
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    return "beerjson";
  }
  if (trimmed.startsWith("<")) {
    return "beerxml";
  }
  return null;
}

/**
 * Downloads an exported recipe file on web, or opens the native share sheet on iOS/Android.
 */
export async function deliverExportedFile(opts: {
  filename: string;
  contents: string;
  contentType: string;
}): Promise<void> {
  if (Platform.OS === "web" && typeof document !== "undefined" && typeof URL !== "undefined") {
    const blob = new Blob([opts.contents], { type: opts.contentType });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = opts.filename;
    link.style.display = "none";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    return;
  }

  await Share.share({
    title: opts.filename,
    message: opts.contents,
  });
}
