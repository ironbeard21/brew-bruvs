// SPDX-License-Identifier: AGPL-3.0-or-later
import { Platform, Share } from "react-native";
import type { RecipeFileFormat } from "../../api/recipes";

export interface PickedRecipeFile {
  name: string;
  contents: string;
}

const RECIPE_FILE_MIME_TYPES = [
  "application/xml",
  "text/xml",
  "application/json",
  "text/plain",
  "*/*",
];

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
 * Opens the native iOS/Android document picker (via expo-document-picker) to choose a BeerXML or
 * BeerJSON recipe file and reads its UTF-8 text contents via expo-file-system.
 * Returns null if the user cancels the picker.
 */
export async function pickNativeRecipeFile(): Promise<PickedRecipeFile | null> {
  const DocumentPicker = await import("expo-document-picker");
  const result = await DocumentPicker.getDocumentAsync({
    type: RECIPE_FILE_MIME_TYPES,
    copyToCacheDirectory: true,
    multiple: false,
  });

  if (result.canceled || !result.assets?.length) {
    return null;
  }

  const asset = result.assets[0];
  if (!asset) return null;

  let contents: string;
  if (asset.file) {
    contents = await asset.file.text();
  } else {
    try {
      const { File } = await import("expo-file-system");
      contents = await new File(asset.uri).text();
    } catch {
      const response = await fetch(asset.uri);
      if (!response.ok) {
        throw new Error("Could not read the selected recipe file.");
      }
      contents = await response.text();
    }
  }

  return {
    name: asset.name || "recipe.xml",
    contents,
  };
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
