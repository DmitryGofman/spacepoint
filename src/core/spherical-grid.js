import * as THREE from "three";

/**
 * A sphere of radius `R` partitioned into pyramid/frustum cells in spherical
 * coordinates (r, theta, phi). Up axis is world +Y.
 *
 *   r     in [0, R]   split into Rdiv concentric shells
 *   theta in [0, pi]  polar angle from +Y, split into Tdiv bands
 *   phi   in [0, 2pi) azimuth, split into a PER-BAND number of sectors
 *
 * The phi split is EQUAL-AREA: each latitude band uses ~ Pdiv * sin(theta)
 * sectors, so cells stay roughly the same (small) size everywhere and there is
 * no pole singularity — the beam crosses cells at a uniform rate instead of
 * skipping a fan of thin slivers near the poles. The innermost band's cells
 * collapse to true mini-pyramids with their apex at the pole.
 */
export class SphericalGrid {
  constructor({
    R = 1,
    Rdiv = 8,
    Tdiv = 16,
    Pdiv = 32, // sector count at the equator; bands above/below use fewer
    phiMin = 4, // never fewer than this many sectors (keeps pole cells as pyramids)
    // Slicing exponents. 1 = uniform. radialExp < 1 thickens inner shells so the
    // center isn't a cluster of tiny pyramids. thetaExp = 1 keeps latitude even.
    radialExp = 0.7,
    thetaExp = 1.0,
    origin = new THREE.Vector3(),
  } = {}) {
    this.R = R;
    this.Rdiv = Rdiv;
    this.Tdiv = Tdiv;
    this.Pdiv = Pdiv;
    this.phiMin = phiMin;
    this.radialExp = radialExp;
    this.thetaExp = thetaExp;
    this.origin = origin.clone();

    // Precompute per-band sector counts + packing offsets (equal-area).
    this._phiDiv = [];
    this._bandOffset = [];
    let off = 0;
    for (let it = 0; it < Tdiv; it++) {
      const tMid = (this._thetaEdge(it) + this._thetaEdge(it + 1)) * 0.5;
      const n = Math.max(phiMin, Math.round(Pdiv * Math.sin(tMid)));
      this._phiDiv.push(n);
      this._bandOffset.push(off);
      off += n;
    }
    this._bandSum = off; // cells per radial shell
  }

  get cellCount() {
    return this.Rdiv * this._bandSum;
  }

  phiDivAt(it) {
    return this._phiDiv[it];
  }

  // --- tunable slicing -------------------------------------------------------
  //   r(i)     = R * (i / Rdiv)^radialExp        i(r)     = (r/R)^(1/radialExp) * Rdiv
  //   theta(i) = pi * (i / Tdiv)^thetaExp        i(theta) = (theta/pi)^(1/thetaExp) * Tdiv
  _rEdge(i) {
    return this.R * Math.pow(i / this.Rdiv, this.radialExp);
  }
  _rIndex(r) {
    const f = Math.pow(r / this.R, 1 / this.radialExp);
    return Math.min(this.Rdiv - 1, Math.floor(f * this.Rdiv));
  }
  _thetaEdge(i) {
    return Math.PI * Math.pow(i / this.Tdiv, this.thetaExp);
  }
  _thetaIndex(theta) {
    const f = Math.pow(theta / Math.PI, 1 / this.thetaExp);
    return Math.min(this.Tdiv - 1, Math.floor(f * this.Tdiv));
  }

  pack(ir, it, ip) {
    return ir * this._bandSum + this._bandOffset[it] + ip;
  }

  unpack(id) {
    const ir = Math.floor(id / this._bandSum);
    let rem = id - ir * this._bandSum;
    let it = 0;
    while (it + 1 < this.Tdiv && this._bandOffset[it + 1] <= rem) it++;
    const ip = rem - this._bandOffset[it];
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
    const theta = Math.acos(cosTheta);
    let phi = Math.atan2(vz, vx);
    if (phi < 0) phi += Math.PI * 2;

    const ir = this._rIndex(r);
    const it = this._thetaIndex(theta);
    const n = this._phiDiv[it];
    const ip = Math.floor((phi / (Math.PI * 2)) * n) % n;
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
   * Pole-band cells have a degenerate (collapsed) theta edge -> a pyramid.
   */
  cellCorners(id, out = []) {
    const { ir, it, ip } = this.unpack(id);
    const n = this._phiDiv[it];
    const r0 = this._rEdge(ir);
    const r1 = this._rEdge(ir + 1);
    const t0 = this._thetaEdge(it);
    const t1 = this._thetaEdge(it + 1);
    const p0 = (ip / n) * Math.PI * 2;
    const p1 = ((ip + 1) / n) * Math.PI * 2;
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
    const n = this._phiDiv[it];
    const r = (this._rEdge(ir) + this._rEdge(ir + 1)) * 0.5;
    const theta = (this._thetaEdge(it) + this._thetaEdge(it + 1)) * 0.5;
    const phi = ((ip + 0.5) / n) * Math.PI * 2;
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
