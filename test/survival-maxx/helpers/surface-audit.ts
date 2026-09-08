import * as THREE from "three";

function meshes(root: THREE.Object3D): THREE.Mesh[] {
  const result: THREE.Mesh[] = [];
  root.traverse((object) => {
    if (object instanceof THREE.Mesh) result.push(object);
  });
  return result;
}

type Point2 = [number, number];
type SurfaceFace = {
  normal: THREE.Vector3;
  distance: number;
  vertices: THREE.Vector3[];
  projected: Point2[];
  axes: number[];
  droppedAxis: number;
  finish: string;
};
const cross2 = (a: Point2, b: Point2) => a[0] * b[1] - a[1] * b[0];

/** Clip one triangle against another; a shared edge is not an overlap. */
function intersectTriangles(a: Point2[], b: Point2[]): Point2[] {
  let polygon = a;
  const winding = Math.sign(
    cross2(
      [b[1][0] - b[0][0], b[1][1] - b[0][1]],
      [b[2][0] - b[0][0], b[2][1] - b[0][1]],
    ),
  );
  for (let i = 0; i < 3 && polygon.length; i++) {
    const start = b[i];
    const end = b[(i + 1) % 3];
    const edge: Point2 = [end[0] - start[0], end[1] - start[1]];
    const signedDistance = (point: Point2) =>
      winding * cross2(edge, [point[0] - start[0], point[1] - start[1]]);
    const input = polygon;
    polygon = [];
    for (let j = 0; j < input.length; j++) {
      const p = input[j],
        q = input[(j + 1) % input.length];
      const dp = signedDistance(p),
        dq = signedDistance(q);
      const insideP = dp >= -1e-10,
        insideQ = dq >= -1e-10;
      if (insideP) polygon.push(p);
      if (insideP !== insideQ) {
        const t = dp / (dp - dq);
        polygon.push([p[0] + t * (q[0] - p[0]), p[1] + t * (q[1] - p[1])]);
      }
    }
  }
  return polygon;
}

/**
 * Audit the finished baked mesh from every surface direction, not just the
 * portrait camera. Nine visibility rays distinguish exposed z-fighting from
 * harmless surfaces buried inside an opaque armor volume.
 */
export function exposedSurfaceConflicts(root: THREE.Object3D): string[] {
  root.updateMatrixWorld(true);
  const planes = new Map<string, SurfaceFace[]>();
  for (const mesh of meshes(root)) {
    const geometry = mesh.geometry;
    const positions = geometry.getAttribute("position");
    const colors = geometry.getAttribute("color");
    const indices = geometry.index;
    const material = mesh.material as THREE.MeshStandardMaterial;
    const colorAt = (i: number) =>
      colors
        ? [colors.getX(i), colors.getY(i), colors.getZ(i)]
            .map((value) => value.toFixed(4))
            .join(",")
        : material.color.getHexString();
    for (
      let offset = 0;
      offset < (indices?.count ?? positions.count);
      offset += 3
    ) {
      const ids = [0, 1, 2].map(
        (index) => indices?.getX(offset + index) ?? offset + index,
      );
      const vertices = ids.map((id) =>
        new THREE.Vector3()
          .fromBufferAttribute(positions, id)
          .applyMatrix4(mesh.matrixWorld),
      );
      const normal = vertices[1]
        .clone()
        .sub(vertices[0])
        .cross(vertices[2].clone().sub(vertices[0]));
      if (normal.lengthSq() < 1e-14) continue;
      normal.normalize();
      const distance = normal.dot(vertices[0]);
      const key = [...normal.toArray(), distance]
        .map((value) => Math.round(value * 1000))
        .join(",");
      const magnitudes = normal.toArray().map(Math.abs);
      const droppedAxis = magnitudes.indexOf(Math.max(...magnitudes));
      const axes = [0, 1, 2].filter((axis) => axis !== droppedAxis);
      const face: SurfaceFace = {
        normal,
        distance,
        vertices,
        axes,
        droppedAxis,
        projected: vertices.map((vertex) => [
          vertex.getComponent(axes[0]),
          vertex.getComponent(axes[1]),
        ]),
        finish: `${material.type}:${colorAt(ids[0])}`,
      };
      const bucket = planes.get(key);
      if (bucket) bucket.push(face);
      else planes.set(key, [face]);
    }
  }
  const conflicts: string[] = [];
  const ray = new THREE.Raycaster();
  for (const faces of planes.values()) {
    for (let i = 0; i < faces.length; i++) {
      for (let j = i + 1; j < faces.length; j++) {
        const a = faces[i],
          b = faces[j];
        if (
          a.finish === b.finish ||
          a.normal.dot(b.normal) < 0.99999 ||
          b.vertices.some(
            (vertex) => Math.abs(a.normal.dot(vertex) - a.distance) > 0.00002,
          )
        )
          continue;
        const polygon = intersectTriangles(a.projected, b.projected);
        if (polygon.length < 3) continue;
        const area =
          Math.abs(
            polygon.reduce(
              (sum, point, index) =>
                sum + cross2(point, polygon[(index + 1) % polygon.length]),
              0,
            ),
          ) / 2;
        if (area < 0.000001) continue;
        const center = polygon.reduce<Point2>(
          (sum, point) => [
            sum[0] + point[0] / polygon.length,
            sum[1] + point[1] / polygon.length,
          ],
          [0, 0],
        );
        const position = new THREE.Vector3();
        position.setComponent(a.axes[0], center[0]);
        position.setComponent(a.axes[1], center[1]);
        position.setComponent(
          a.droppedAxis,
          (a.distance -
            a.normal.getComponent(a.axes[0]) * center[0] -
            a.normal.getComponent(a.axes[1]) * center[1]) /
            a.normal.getComponent(a.droppedAxis),
        );
        const tangent =
          Math.abs(a.normal.x) < 0.9
            ? new THREE.Vector3(1, 0, 0)
            : new THREE.Vector3(0, 1, 0);
        tangent.addScaledVector(a.normal, -tangent.dot(a.normal)).normalize();
        const bitangent = a.normal.clone().cross(tangent);
        const views: Point2[] = [
          [0, 0],
          [0.8, 0],
          [-0.8, 0],
          [0, 0.8],
          [0, -0.8],
          [0.7, 0.7],
          [-0.7, 0.7],
          [0.7, -0.7],
          [-0.7, -0.7],
        ];
        const visible = views.some(([x, y]) => {
          const direction = a.normal
            .clone()
            .addScaledVector(tangent, x)
            .addScaledVector(bitangent, y)
            .normalize();
          ray.set(
            position.clone().addScaledVector(direction, 8),
            direction.clone().negate(),
          );
          ray.far = 8.001;
          const closest = ray.intersectObject(root, true)[0];
          return !closest || closest.distance >= 7.9998;
        });
        if (visible)
          conflicts.push(
            `surface at ${position
              .toArray()
              .map((value) => value.toFixed(3))
              .join(", ")}, normal ${a.normal
              .toArray()
              .map((value) => value.toFixed(2))
              .join(", ")}`,
          );
      }
    }
  }
  return conflicts;
}
