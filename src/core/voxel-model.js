/**
 * The source of truth for a figure: which cells are lit, and how.
 * Only lit cells exist in the map, keyed by the grid's packed integer id, so
 * light / erase / "is lit?" are all O(1).
 */
export class VoxelModel {
  constructor(grid) {
    this.grid = grid;
    this.cells = new Map(); // id -> { id, color, intensity }
    this.dirty = true; // renderers rebuild when this is set
  }

  has(id) {
    return this.cells.has(id);
  }

  light(id, color = 0x33ff99, intensity = 1) {
    if (id < 0) return false;
    const existing = this.cells.get(id);
    if (existing && existing.color === color && existing.intensity === intensity)
      return false;
    this.cells.set(id, { id, color, intensity });
    this.dirty = true;
    return true;
  }

  erase(id) {
    if (this.cells.delete(id)) {
      this.dirty = true;
      return true;
    }
    return false;
  }

  toggle(id, color = 0x33ff99, intensity = 1) {
    if (id < 0) return false;
    if (this.cells.has(id)) return this.erase(id);
    return this.light(id, color, intensity);
  }

  clear() {
    if (this.cells.size === 0) return;
    this.cells.clear();
    this.dirty = true;
  }

  get size() {
    return this.cells.size;
  }

  serialize() {
    const g = this.grid;
    return {
      R: g.R,
      Rdiv: g.Rdiv,
      Tdiv: g.Tdiv,
      Pdiv: g.Pdiv,
      cells: [...this.cells.values()].map((c) => [c.id, c.color, c.intensity]),
    };
  }

  load(data) {
    this.cells.clear();
    for (const [id, color, intensity] of data.cells ?? [])
      this.cells.set(id, { id, color, intensity });
    this.dirty = true;
  }
}
