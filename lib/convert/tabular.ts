import type { ConversionResult, Format } from "./types";
import { stripExt } from "./types";

type AOA = unknown[][];

/**
 * Tabular conversions: CSV / TSV / JSON / XLSX. CSV and TSV differ only
 * in the field separator; everything else flows through the same
 * SheetJS-backed pipeline.
 */
export async function convertTabular(
  file: File,
  from: Format,
  to: Format,
): Promise<ConversionResult> {
  const XLSX = await import("xlsx");

  let aoa: AOA;
  let sheetName = "Sheet1";

  if (from === "csv" || from === "tsv") {
    const text = await file.text();
    const wb = XLSX.read(text, {
      type: "string",
      ...(from === "tsv" ? { FS: "\t" } : {}),
    });
    sheetName = wb.SheetNames[0] ?? "Sheet1";
    aoa = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], {
      header: 1,
    }) as AOA;
  } else if (from === "json") {
    const text = await file.text();
    const data = JSON.parse(text);
    aoa = jsonToAoa(data);
  } else if (from === "xlsx") {
    const buf = await file.arrayBuffer();
    const wb = XLSX.read(buf, { type: "array" });
    sheetName = wb.SheetNames[0] ?? "Sheet1";
    aoa = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], {
      header: 1,
    }) as AOA;
  } else {
    throw new Error(`Unsupported tabular input: ${from}`);
  }

  const base = stripExt(file.name);

  if (to === "csv" || to === "tsv") {
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    const text = XLSX.utils.sheet_to_csv(ws, {
      ...(to === "tsv" ? { FS: "\t" } : {}),
    });
    const mime = to === "tsv"
      ? "text/tab-separated-values;charset=utf-8"
      : "text/csv;charset=utf-8";
    return {
      blob: new Blob([text], { type: mime }),
      filename: `${base}.${to}`,
    };
  }

  if (to === "json") {
    const json = aoaToJson(aoa);
    return {
      blob: new Blob([JSON.stringify(json, null, 2)], {
        type: "application/json;charset=utf-8",
      }),
      filename: `${base}.json`,
    };
  }

  if (to === "xlsx") {
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, sheetName);
    const out = XLSX.write(wb, { type: "array", bookType: "xlsx" });
    return {
      blob: new Blob([out], {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      }),
      filename: `${base}.xlsx`,
    };
  }

  throw new Error(`Unsupported tabular output: ${to}`);
}

function jsonToAoa(data: unknown): AOA {
  if (!Array.isArray(data)) {
    throw new Error("JSON must be an array of objects or an array of arrays.");
  }
  if (data.length === 0) return [];

  // Array of arrays — pass through.
  if (Array.isArray(data[0])) {
    return data as AOA;
  }

  // Array of objects — derive headers from union of keys.
  const headers = new Set<string>();
  for (const row of data) {
    if (row && typeof row === "object") {
      for (const k of Object.keys(row as Record<string, unknown>)) {
        headers.add(k);
      }
    }
  }
  const cols = [...headers];
  const rows: AOA = [cols];
  for (const row of data) {
    rows.push(
      cols.map((c) => (row as Record<string, unknown>)[c] ?? ""),
    );
  }
  return rows;
}

function aoaToJson(aoa: AOA): Record<string, unknown>[] {
  if (aoa.length === 0) return [];
  const [headers, ...rows] = aoa;
  return rows.map((r) => {
    const o: Record<string, unknown> = {};
    (headers as unknown[]).forEach((h, i) => {
      o[String(h)] = r[i];
    });
    return o;
  });
}
