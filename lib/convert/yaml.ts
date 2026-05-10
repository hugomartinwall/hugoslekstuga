import type { ConversionResult, Format } from "./types";
import { stripExt } from "./types";

/**
 * YAML ↔ JSON. The same data shape, two textual representations.
 * Useful for devs converting CI configs, k8s manifests, GitHub Actions
 * snippets, OpenAPI specs, etc.
 */
export async function convertYaml(
  file: File,
  from: Format,
  to: Format,
): Promise<ConversionResult> {
  const yaml = await import("js-yaml");
  const text = await file.text();
  const base = stripExt(file.name);

  if (from === "yaml" && to === "json") {
    const data = yaml.load(text);
    return {
      blob: new Blob([JSON.stringify(data, null, 2)], {
        type: "application/json;charset=utf-8",
      }),
      filename: `${base}.json`,
    };
  }

  if (from === "json" && to === "yaml") {
    const data = JSON.parse(text);
    const yamlText = yaml.dump(data, { indent: 2, lineWidth: 100 });
    return {
      blob: new Blob([yamlText], { type: "text/yaml;charset=utf-8" }),
      filename: `${base}.yaml`,
    };
  }

  throw new Error(`Unsupported YAML conversion: ${from} → ${to}`);
}
