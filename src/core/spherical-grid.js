import * as THREE from "three";

/**
 * A sphere of radius `R` partitioned into pyramid/frustum cells in spherical
 * coordinates (r, theta, phi). Up axis is world +Y.
 *
 *   r     in [0, R]   split into Rdiv concentric shells
 *   theta in [0, pi]  polar angle from +Y, split into Tdiv bands
 *   phi   in [0, 2pi) azimuth around +Y, split into Pdiv sectors
 *
 * Each cell is a curved truncated pyramid (frustum) with its apex toward the
 * center; the innermost shell collapses to true pyramids. The grid is implicit:
 * we never instantiate cells, we compute the cell an arbitrary point falls in.
 */
export class SphericalGrid {
  constructor({
    R = 1,
    Rdiv = 6,
    Tdiv = 12,
    Pdiv = 24,
    origin = new THREE.Vector3(),
  } = {}) {
    this.R = R;
    this.Rdiv = Rdiv;
    this.Tdiv = Tdiv;
    this.Pdiv = Pdiv;
    this.origin = origin.clone();
  }

  get cellCount() {
    return this.Rdiv * this.Tdiv * this.Pdiv;
  }

  // --- non-uniform slicing so cells are more even in size --------------------
  // Equal-VOLUME radial shells: inner shells are thicker (a big, easy-to-hit
  // cell at the center) instead of the center being a cluster of tiny pyramids.
  //   r(i) = R * (i / Rdiv)^(1/3)        edge i in [0, Rdiv]
  //   i(r) = floor( (r/R)^3 * Rdiv )
  _rEdge(i) {
    return this.R * Math.cbrt(i / this.Rdiv);
  }
  _rIndex(r) {
    const f = r / this.R;
    return Math.min(this.Rdiv - 1, Math.floor(f * f * f * this.Rdiv));
  }

  // Equal-AREA latitude bands (slice by cos theta): bands near the poles span a
  // wider polar angle, so the top/bottom cells are fatter and easier to aim.
  //   theta(i) = acos(1 - 2 i / Tdiv)    edge i in [0, Tdiv]
  //   i(theta) = floor( (1 - cos theta)/2 * Tdiv )
  _thetaEdge(i) {
    return Math.acos(Math.min(1, Math.max(-1, 1 - (2 * i) / this.Tdiv)));
  }
  _thetaIndex(cosTheta) {
    return Math.min(
      this.Tdiv - 1,
      Math.floor(((1 - cosTheta) / 2) * this.Tdiv)
    );
  }

  pack(ir, it, ip) {
    return (ir * this.Tdiv + it) * this.Pdiv + ip;
  }

  unpack(id) {
    const ip = id % this.Pdiv;
    const it = Math.floor(id / this.Pdiv) % this.Tdiv;
    const ir = Math.floor(id / (this.Pdiv * this.Tdiv));
    return { ir, it, ip };
  }

  /** World point -> cell id, or -1 if the point is outside the sphere. */
  cellAt(point) {
    const vx = point.x - this.origin.x;
    const vy = point.y - this.origin.y;
    const vz = point.z - this.origin.z;
    const r = Math.sqrt(vx * vx + vy * vy + vz * vz);
    if (r > this.R) return -1;

    const cosTheta = r === 0 ? 1 : Math.min(1, Math.max(-1, vy / r));
    let phi = Math.atan2(vz, vx);
    if (phi < 0) phi += Math.PI * 2;

    const ir = this._rIndex(r);
    const it = this._thetaIndex(cosTheta);
    const ip = Math.floor((phi / (Math.PI * 2)) * this.Pdiv) % this.Pdiv;
    return this.pack(ir, it, ip);
  }

  /** Spherical (r, theta, phi) -> world Cartesian (Vector3). */
  _toCartesian(r, theta, phi, out = new THREE.Vector3()) {
    const st = Math.sin(theta);
    return out.set(
      this.origin.x + r * st * Math.cos(phi),
      this.origin.y + r * Math.cos(theta),
      this.origin.z + r * st * Math.sin(phi)
    );
  }

  /**
   * The 8 world-space corners of a cell, ordered by the bit pattern
   * index = ri*4 + ti*2 + pi  (ri,ti,pi each 0 = low bound, 1 = high bound).
   */
  cellCorners(id, out = []) {
    const { ir, it, ip } = this.unpack(id);
    const r0 = this._rEdge(ir);
    const r1 = this._rEdge(ir + 1);
    const t0 = this._thetaEdge(it);
    const t1 = this._thetaEdge(it + 1);
    const p0 = (ip / this.Pdiv) * Math.PI * 2;
    const p1 = ((ip + 1) / this.Pdiv) * Math.PI * 2;
    const rs = [r0, r1];
    const ts = [t0, t1];
    const ps = [p0, p1];
    let k = 0;
    for (let ri = 0; ri < 2; ri++)
      for (let ti = 0; ti < 2; ti++)
        for (let pi = 0; pi < 2; pi++) {
          out[k] = this._toCartesian(rs[ri], ts[ti], ps[pi], out[k]);
          k++;
        }
    out.length = 8;
    return out;
  }

  cellCenter(id, out = new THREE.Vector3()) {
    const { ir, it, ip } = this.unpack(id);
    const r = (this._rEdge(ir) + this._rEdge(ir + 1)) * 0.5;
    const theta = (this._thetaEdge(it) + this._thetaEdge(it + 1)) * 0.5;
    const phi = ((ip + 0.5) / this.Pdiv) * Math.PI * 2;
    return this._toCartesian(r, theta, phi, out);
  }

  /**
   * A conservative step length for walking a segment without skipping cells
   * (used by the line-fill brush). Half the smallest cell extent over the grid.
   */
  sampleStep() {
    return this.R / (2 * Math.max(this.Rdiv, this.Tdiv, this.Pdiv));
  }
}
