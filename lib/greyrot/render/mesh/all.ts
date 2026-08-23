/**
 * Imports every module that registers meshes, for side effects.
 *
 * Anything that wants the full roster — the preview harness, the regression
 * test, the runtime asset builder — imports this rather than the registry
 * directly, so a new creature file is picked up by all three at once.
 */

import "../chars/humanoid";
import "../chars/sporeling";
import "../chars/weapons";
// World dressing that registers preview-able props (the brazier). The
// blockers themselves stay preview-invisible — they are instanced by Scatter,
// not built per-piece — but a prop being sculpted needs the sculpting window.
import "../world/scatter";
// The roadside landmark family (R5): the well-ring, the strike-stones, the
// fallen giant, the kiln domes and the Great Snag. (The parapet stubs were
// here until R6, when the crossing was cut generator and all — an unplaced
// generator is still shipped geometry, because `registerMesh` is a top-level
// side effect. This list is exactly the placed family and stays that way.) These
// are sculpted objects, so the sculpting window has to be able to see them —
// and registering them is also what puts them under mesh regression.
import "../world/landmarks";

export * from "./registry";
