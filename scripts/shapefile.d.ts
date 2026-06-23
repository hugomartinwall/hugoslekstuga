/**
 * Minimal ambient declaration for the `shapefile` package (no bundled types).
 * Only the streaming reader surface the bake script uses.
 */
declare module "shapefile" {
  export interface ShapefileSource {
    read(): Promise<{
      done: boolean;
      value: {
        type: string;
        geometry: {
          type: string;
          // Polygon: number[][][]   MultiPolygon: number[][][][]
          coordinates: number[][][] | number[][][][];
        } | null;
        properties: Record<string, unknown>;
      };
    }>;
  }
  export function open(
    shp: string,
    dbf?: string | null,
    options?: { encoding?: string },
  ): Promise<ShapefileSource>;
}
