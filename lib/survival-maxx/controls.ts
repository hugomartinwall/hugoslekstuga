export interface NavigationPoint {
  x: number;
  y: number;
}

export type PointerProjector = (
  clientX: number,
  clientY: number,
) => NavigationPoint | null;

/** Held input follows the camera; released input keeps a world destination. */
export class PointerNavigation {
  held = false;
  target: NavigationPoint | null = null;
  private client: NavigationPoint | null = null;

  begin(clientX: number, clientY: number, project: PointerProjector) {
    this.held = true;
    this.client = { x: clientX, y: clientY };
    this.project(project);
  }

  move(clientX: number, clientY: number) {
    if (this.held) this.client = { x: clientX, y: clientY };
  }

  end(cancel = false) {
    this.held = false;
    this.client = null;
    if (cancel) this.target = null;
  }

  clear() {
    this.end(true);
  }

  input(player: NavigationPoint, project: PointerProjector): NavigationPoint {
    if (this.held) this.project(project);
    if (!this.target) return { x: 0, y: 0 };

    const x = this.target.x - player.x;
    const y = this.target.y - player.y;
    const distance = Math.hypot(x, y);
    if (distance <= 0.3) {
      this.target = null;
      return { x: 0, y: 0 };
    }
    return { x: x / distance, y: y / distance };
  }

  private project(project: PointerProjector) {
    if (!this.client) return;
    const point = project(this.client.x, this.client.y);
    this.target = point ? { x: point.x, y: point.y } : null;
  }
}
