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
    this.undoStack = []; // each entry: Map<id, prevCellOrNull>
    this._rec = null; // active edit recording, or null
  }

  has(id) {
    return this.cells.has(id);
  }

  // --- undo plumbing ---------------------------------------------------------
  beginEdit() {
    this._rec = new Map();
  }
  _touch(id) {
    if (this._rec && !this._rec.has(id))
      this._rec.set(id, this.cells.has(id) ? { ...this.cells.get(id) } : null);
  }
  commitEdit() {
    if (this._rec && this._rec.size) {
      this.undoStack.push(this._rec);
      if (this.undoStack.length > 80) this.undoStack.shift();
    }
    this._rec = null;
  }
  undo() {
    const rec = this.undoStack.pop();
    if (!rec) return false;
    for (const [id, prev] of rec) {
      if (prev === null) this.cells.delete(id);
      else this.cells.set(id, prev);
    }
    this.dirty = true;
    return true;
  }
  get canUndo() {
    return this.undoStack.length > 0;
  }

  light(id, color = 0x33ff99, intensity = 1) {
    if (id < 0) return false;
    const existing = this.cells.get(id);
    if (existing && existing.color === color && existing.intensity === intensity)
      return false;
    this._touch(id);
    this.cells.set(id, { id, color, intensity });
    this.dirty = true;
    return true;
  }

  erase(id) {
    if (this.cells.has(id)) {
      this._touch(id);
      this.cells.delete(id);
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
    const rec = new Map();
    for (const [id, c] of this.cells) rec.set(id, { ...c });
    this.undoStack.push(rec); // so Undo restores a cleared figure
    if (this.undoStack.length > 80) this.undoStack.shift();
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
