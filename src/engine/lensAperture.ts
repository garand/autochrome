/**
 * Automatic glass-side rim tracing for 384px face crops (2x the face box).
 * Pure: no dependencies, I/O, mutable global state, or input mutation.
 * Polygons contain 96 samples plus an explicit closing point; coordinates use pixel centres.
 * Confidence measures edge support, NOT the probability of glasses or pixel accuracy.
 * See NOTES.md for validation limits, especially defocus and ambiguous transparent rims.
 */
type Point = [number, number];
type Shape = { x: number; y: number; rx: number; ry: number; p: number };
const clamp = (x: number, a: number, b: number) => Math.max(a, Math.min(b, x));
export function findLensApertures(
  rgba: Uint8ClampedArray,
  N: number,
  mesh: number[][],
): { polys: Point[][]; confidence: number } | null {
  const eyes = [
    [33, 133, 159, 145],
    [263, 362, 386, 374],
  ];
  if (
    !Number.isInteger(N) ||
    N < 16 ||
    rgba.length !== N * N * 4 ||
    eyes
      .flat()
      .some(
        (i) =>
          !mesh[i] ||
          !Number.isFinite(mesh[i][0]) ||
          !Number.isFinite(mesh[i][1]),
      )
  )
    return null;
  let ax = mesh[263][0] - mesh[33][0],
    ay = mesh[263][1] - mesh[33][1];
  const al = Math.hypot(ax, ay);
  if (al < 10) return null;
  ax /= al;
  ay /= al;
  const origin: Point = [
    (mesh[133][0] + mesh[362][0]) / 2,
    (mesh[133][1] + mesh[362][1]) / 2,
  ];
  if (
    origin[0] < N * 0.15 ||
    origin[0] > N * 0.85 ||
    origin[1] < N * 0.2 ||
    origin[1] > N * 0.8
  )
    return null;
  const toLocal = (p: number[]): Point => [
    (p[0] - origin[0]) * ax + (p[1] - origin[1]) * ay,
    -(p[0] - origin[0]) * ay + (p[1] - origin[1]) * ax,
  ];
  const world = (x: number, y: number): Point => [
    origin[0] + ax * x - ay * y,
    origin[1] + ay * x + ax * y,
  ];
  const lum = new Float32Array(N * N),
    luma = new Float32Array(N * N);
  for (let i = 0; i < lum.length; i++)
    lum[i] =
      (rgba[i * 4] * 0.7 + rgba[i * 4 + 1] * 0.1 + rgba[i * 4 + 2] * 0.2) / 255;
  for (let i = 0; i < lum.length; i++)
    luma[i] =
      (rgba[i * 4] * 0.3 + rgba[i * 4 + 1] * 0.5 + rgba[i * 4 + 2] * 0.2) / 255;
  for (const A of [lum, luma]) {
    const tmp = new Float32Array(N * N);
    for (let y = 0; y < N; y++)
      for (let x = 0; x < N; x++) {
        const k = y * N + x;
        tmp[k] =
          0.25 * A[y * N + Math.max(0, x - 1)] +
          0.5 * A[k] +
          0.25 * A[y * N + Math.min(N - 1, x + 1)];
      }
    for (let y = 0; y < N; y++)
      for (let x = 0; x < N; x++) {
        const k = y * N + x;
        A[k] =
          0.25 * tmp[Math.max(0, y - 1) * N + x] +
          0.5 * tmp[k] +
          0.25 * tmp[Math.min(N - 1, y + 1) * N + x];
      }
  }
  const sample = (x: number, y: number, A: Float32Array = lum) => {
    const p = world(x, y);
    const xx = clamp(p[0], 0, N - 1.001),
      yy = clamp(p[1], 0, N - 1.001);
    const ix = xx | 0,
      iy = yy | 0,
      fx = xx - ix,
      fy = yy - iy,
      k = iy * N + ix;
    return (
      (A[k] * (1 - fx) + A[k + 1] * fx) * (1 - fy) +
      (A[k + N] * (1 - fx) + A[k + N + 1] * fx) * fy
    );
  };
  const bases = eyes.map((ids) => {
    const pp = ids.map((i) => toLocal(mesh[i]));
    const ew = Math.hypot(pp[0][0] - pp[1][0], pp[0][1] - pp[1][1]);
    return {
      x: pp.reduce((s, p) => s + p[0], 0) / 4,
      y: pp.reduce((s, p) => s + p[1], 0) / 4 + ew * 0.15,
      ew,
    };
  });
  if (bases.some((b) => b.ew < 5 || b.ew > N * 0.3)) return null;
  const ew = (bases[0].ew + bases[1].ew) / 2;
  let bridge = 0,
    inside = 0;
  for (let i = -2; i <= 2; i++) {
    bridge += sample(i * ew * 0.025, 0);
    for (const b of bases)
      inside += sample(b.x + i * ew * 0.05, b.y + b.ew * 0.45) / 2;
  }
  bridge /= 5;
  inside /= 5;
  let bridgeMin = bridge;
  for (let y = -0.35 * ew; y <= 0.65 * ew; y += 1) {
    let v = 0;
    for (let i = -2; i <= 2; i++) v += sample(i * ew * 0.025, y) / 5;
    bridgeMin = Math.min(bridgeMin, v);
  }
  const polarity = bridgeMin < inside - 0.12 ? -1 : 1;
  // A signed step into the rim; cap its strength so one lash cannot beat a whole rim.
  const evidence = (
    x: number,
    y: number,
    nx: number,
    ny: number,
    fine = false,
  ) => {
    const A = fine && ny > 0.2 ? luma : lum;
    const a = sample(x - nx * 1.1, y - ny * 1.1, A),
      b = sample(x + nx * 1.1, y + ny * 1.1, A);
    const near = polarity * (b - a);
    const c = sample(x + nx * 5, y + ny * 5, A);
    const band = polarity * (sample(x + nx * 2, y + ny * 2, A) - c);
    return Math.tanh(near * 6) + 0.6 * Math.tanh(Math.max(0, band) * 6);
  };
  const point = (s: Shape, a: number): Point => {
    const c = Math.cos(a),
      d = Math.sin(a),
      r = (Math.abs(c) ** s.p + Math.abs(d) ** s.p) ** (-1 / s.p);
    return [s.x + s.rx * c * r, s.y + s.ry * d * r];
  };
  const templates = new Map<number, number[][]>();
  const template = (p: number) => {
    const key = Math.round(p * 1000);
    let t = templates.get(key);
    if (t) return t;
    t = [];
    for (let j = 0; j < 48; j++) {
      const a = (j * Math.PI) / 24,
        c = Math.cos(a),
        d = Math.sin(a),
        r = (Math.abs(c) ** p + Math.abs(d) ** p) ** (-1 / p),
        u = c * r,
        v = d * r;
      t.push([
        u,
        v,
        Math.sign(u) * Math.abs(u) ** (p - 1),
        Math.sign(v) * Math.abs(v) ** (p - 1),
      ]);
    }
    templates.set(key, t);
    return t;
  };
  const shapeScore = (s: Shape, e: number) => {
    let score = 0;
    for (const t of template(s.p)) {
      const x = s.x + s.rx * t[0],
        y = s.y + s.ry * t[1];
      let nx = t[2] / s.rx,
        ny = t[3] / s.ry;
      const nl = Math.hypot(nx, ny);
      nx /= nl;
      ny /= nl;
      score += evidence(x, y, nx, ny);
    }

    for (const id of polarity > 0 ? eyes[e] : []) {
      const p = toLocal(mesh[id]);
      const r =
        (Math.abs((p[0] - s.x) / s.rx) ** s.p +
          Math.abs((p[1] - s.y) / s.ry) ** s.p) **
        (1 / s.p);
      score -= 60 * Math.max(0, r - 0.98);
    }
    if (s.x - s.rx < 0 && s.x + s.rx > 0) score -= 100;
    return score;
  };
  const polys: Point[][] = [];
  let quality = 0;
  for (let e = 0; e < 2; e++) {
    const b = bases[e],
      sign = e ? 1 : -1;
    const seeds: { s: Shape; sc: number }[] = [];
    let best: Shape = { x: b.x, y: b.y, rx: b.ew * 1.1, ry: b.ew * 0.75, p: 3 },
      bs = -Infinity;
    for (const p of [2.5, 3.5, 5])
      for (const dx of [-0.1, 0.05, 0.2, 0.35])
        for (const dy of [-0.2, 0, 0.2, 0.4, 0.6])
          for (const sx of [0.85, 1, 1.15, 1.3])
            for (const sy of [0.55, 0.7, 0.85, 1.0]) {
              const s = {
                x: b.x + sign * dx * b.ew,
                y: b.y + dy * b.ew,
                rx: sx * b.ew,
                ry: sy * b.ew,
                p,
              };
              const sc = shapeScore(s, e);
              seeds.push({ s, sc });
            }
    seeds.sort((a, b) => b.sc - a.sc);
    const chosen: Shape[] = [];
    for (const z of seeds) {
      if (
        chosen.every(
          (s) =>
            Math.hypot(s.x - z.s.x, s.y - z.s.y, s.rx - z.s.rx, s.ry - z.s.ry) >
            b.ew * 0.18,
        )
      )
        chosen.push(z.s);
      if (chosen.length === 24) break;
    }
    const fitted: { s: Shape; sc: number }[] = [];
    let winner = best,
      winScore = -Infinity;
    for (const seed of chosen) {
      best = seed;
      bs = shapeScore(best, e);
      for (const step of [3, 1.5, 0.75, 0.35])
        for (let pass = 0; pass < 3; pass++)
          for (const key of ["x", "y", "rx", "ry", "p"] as const) {
            for (const dir of [-1, 1]) {
              const s = {
                ...best,
                [key]: best[key] + dir * (key === "p" ? step * 0.3 : step),
              };
              if (
                s.p < 2 ||
                s.p > 6 ||
                s.rx < b.ew * 0.75 ||
                s.rx > b.ew * 1.5 ||
                s.ry < b.ew * 0.5 ||
                s.ry > b.ew * 1.2
              )
                continue;
              const sc = shapeScore(s, e);
              if (sc > bs) {
                bs = sc;
                best = s;
              }
            }
          }
      fitted.push({ s: best, sc: bs });
      if (bs > winScore) {
        winScore = bs;
        winner = best;
      }
    }
    best = winner;
    // Radial offset lattice about each independently fitted rounded rectangle.
    const M = 96,
      S = 41,
      h = 0.4,
      range = (S - 1) / 2;
    fitted.sort((a, b) => b.sc - a.sc);
    const finalists: Shape[] = [];
    for (const f of fitted) {
      if (
        finalists.every(
          (s) =>
            Math.hypot(s.x - f.s.x, s.y - f.s.y, s.rx - f.s.rx, s.ry - f.s.ry) >
            2,
        )
      )
        finalists.push(f.s);
      if (finalists.length === 5) break;
    }
    let cost = new Float32Array(M * S),
      bestCost = cost,
      selected = best,
      bestEnergy = Infinity;
    for (const trial of finalists) {
      best = trial;
      cost = new Float32Array(M * S);
      for (let j = 0; j < M; j++) {
        const a = (j * 2 * Math.PI) / M,
          p = point(best, a),
          dx = p[0] - best.x,
          dy = p[1] - best.y,
          r = Math.hypot(dx, dy),
          ux = dx / r,
          uy = dy / r;
        const prev = point(best, a - 0.001),
          next = point(best, a + 0.001),
          tx = next[0] - prev[0],
          ty = next[1] - prev[1],
          tl = Math.hypot(tx, ty),
          nx = ty / tl,
          ny = -tx / tl;
        for (let k = 0; k < S; k++) {
          const d = (k - range) * h,
            x = p[0] + ux * d,
            y = p[1] + uy * d;
          const minRadius = Math.hypot(
            (x - best.x) / (0.85 * b.ew),
            (y - best.y) / (0.55 * b.ew),
          );
          cost[j * S + k] =
            -evidence(x, y, nx, ny, true) +
            0.0015 * d * d +
            0.035 * d * nx ** 4 +
            (polarity > 0 ? 10 * Math.max(0, 1 - minRadius) : 0);
        }
      }
      // Cheap repeated-lap trace ranks candidate basins by their deformable contour,
      // rather than committing to whichever rigid shape happened to score highest.
      let d0 = new Float64Array(S),
        d1 = new Float64Array(S);
      let offset = 0,
        previous = 0;
      for (let t = 0; t < M * 3; t++) {
        if (t === M * 2) previous = offset;
        for (let k = 0; k < S; k++) {
          let v = Infinity;
          for (let l = Math.max(0, k - 4); l <= Math.min(S - 1, k + 4); l++)
            v = Math.min(v, d0[l] + 0.035 * (k - l) ** 2);
          d1[k] = v + cost[(t % M) * S + k];
        }
        const minimum = Math.min(...d1);
        offset += minimum;
        for (let k = 0; k < S; k++) d1[k] -= minimum;
        [d0, d1] = [d1, d0];
      }
      const energy = offset - previous;
      if (energy < bestEnergy) {
        bestEnergy = energy;
        bestCost = cost;
        selected = best;
      }
    }
    best = selected;
    cost = bestCost;
    // Enumerate the seam state, including the last-to-first transition: exact cyclic DP.
    const path = cyclicTrace(cost, M, S, 0.035, 4);
    // Refine with second-order continuity and a convexity penalty. Rims are convex;
    // a short excursion over a pupil or past a clear rim must not create a notch.
    const positions: Point[][] = [];
    for (let j = 0; j < M; j++) {
      const p = point(best, (j * 2 * Math.PI) / M),
        r = Math.hypot(p[0] - best.x, p[1] - best.y);
      positions[j] = Array.from(
        { length: S },
        (_, k) =>
          [
            p[0] + ((p[0] - best.x) * (k - range) * h) / r,
            p[1] + ((p[1] - best.y) * (k - range) * h) / r,
          ] as Point,
      );
    }
    const D = 9,
      mid = 4,
      states = S * D;
    let q0 = new Float64Array(states),
      q1 = new Float64Array(states);
    const trace = new Int16Array(M * states);
    q0.fill(Infinity);
    const first = path[0],
      last = path[M - 1];
    q0[first * D + first - last + mid] = cost[first];
    const bend = (j: number, k: number, d: number, prevD: number) => {
      const p = positions[(j + M - 2) % M][k - d - prevD],
        q = positions[(j + M - 1) % M][k - d],
        r = positions[j][k];
      const ux = q[0] - p[0],
        uy = q[1] - p[1],
        vx = r[0] - q[0],
        vy = r[1] - q[1];
      const cross = ux * vy - uy * vx;
      return (
        0.04 * (d - prevD) ** 2 +
        (6 * Math.max(0, -cross)) /
          (Math.hypot(ux, uy) * Math.hypot(vx, vy) + 0.01)
      );
    };
    for (let j = 1; j < M; j++) {
      q1.fill(Infinity);
      for (let k = 0; k < S; k++)
        for (let d = -mid; d <= mid; d++) {
          const prev = k - d;
          if (prev < 0 || prev >= S) continue;
          let score = Infinity,
            from = 0;
          for (let pd = -mid; pd <= mid; pd++) {
            if (prev - pd < 0 || prev - pd >= S) continue;
            const z = q0[prev * D + pd + mid] + bend(j, k, d, pd);
            if (z < score) {
              score = z;
              from = pd;
            }
          }
          const idx = k * D + d + mid;
          q1[idx] = score + cost[j * S + k] + 0.035 * d * d;
          trace[j * states + idx] = from;
        }
      [q0, q1] = [q1, q0];
    }
    let endD = 0,
      score = Infinity;
    for (let d = -mid; d <= mid; d++)
      if (last - d >= 0 && last - d < S) {
        const z = q0[last * D + d + mid] + bend(0, first, first - last, d);
        if (z < score) {
          score = z;
          endD = d;
        }
      }
    if (Number.isFinite(score)) {
      let k = last,
        d = endD;
      for (let j = M - 1; j > 0; j--) {
        path[j] = k;
        const pd = trace[j * states + k * D + d + mid];
        k -= d;
        d = pd;
      }
    }
    // Fractional-state quadratic interpolation removes radial quantization. The same
    // cyclic regularizer is included, so this does not independently snap to new edges.
    const offsets = new Float64Array(M);
    for (let j = 0; j < M; j++) {
      const k = path[j],
        left = path[(j + M - 1) % M],
        right = path[(j + 1) % M];
      const energy = (l: number) =>
        cost[j * S + l] + 0.035 * ((l - left) ** 2 + (l - right) ** 2);
      let dk = 0;
      if (k > 0 && k < S - 1) {
        const a = energy(k - 1),
          b = energy(k),
          c = energy(k + 1);
        if (a + c > 2 * b + 1e-6)
          dk = clamp((0.5 * (a - c)) / (a + c - 2 * b), -0.5, 0.5);
      }
      offsets[j] = (k - range + dk) * h;
      quality += Math.max(0, -cost[j * S + k]) / (M * 2);
    }
    // Localize the rising edge within the selected frame band. This narrow, coupled
    // pass cannot jump across a lens to a reflection or eyelid.
    if (polarity > 0) {
      const F = 17,
        fh = 0.25,
        fcost = new Float32Array(M * F);
      for (let j = 0; j < M; j++) {
        const a = (j * 2 * Math.PI) / M,
          p = point(best, a),
          r = Math.hypot(p[0] - best.x, p[1] - best.y),
          ux = (p[0] - best.x) / r,
          uy = (p[1] - best.y) / r;
        const prev = point(best, a - 0.001),
          next = point(best, a + 0.001),
          tl = Math.hypot(next[0] - prev[0], next[1] - prev[1]),
          nx = (next[1] - prev[1]) / tl,
          ny = -(next[0] - prev[0]) / tl;
        const A = ny > 0.2 ? luma : lum;
        for (let k = 0; k < F; k++) {
          const delta = (k - 8) * fh,
            d = offsets[j] + delta,
            x = p[0] + ux * d,
            y = p[1] + uy * d;
          const inward = sample(x - nx, y - ny, A),
            outward = sample(x + nx, y + ny, A),
            far = sample(x + 3 * nx, y + 3 * ny, A);
          fcost[j * F + k] =
            -Math.tanh(6 * polarity * (outward - inward)) -
            0.1 * Math.tanh(6 * Math.max(0, polarity * (outward - far))) +
            0.025 * delta * delta;
        }
      }
      const fine = cyclicTrace(fcost, M, F, 0.06, 3);
      for (let j = 0; j < M; j++) offsets[j] += (fine[j] - 8) * fh;
    }
    const poly: Point[] = [];
    for (let j = 0; j < M; j++) {
      const a = (j * 2 * Math.PI) / M,
        p = point(best, a),
        r = Math.hypot(p[0] - best.x, p[1] - best.y);
      const d =
        0.2 * offsets[(j + M - 1) % M] +
        0.6 * offsets[j] +
        0.2 * offsets[(j + 1) % M];
      const prev = point(best, a - 0.001),
        next = point(best, a + 0.001),
        tl = Math.hypot(next[0] - prev[0], next[1] - prev[1]);
      // A quarter pixel toward the glass keeps the mixed rim pixels off the mask.
      poly.push(
        world(
          p[0] + ((p[0] - best.x) * d) / r - (0.25 * (next[1] - prev[1])) / tl,
          p[1] + ((p[1] - best.y) * d) / r + (0.25 * (next[0] - prev[0])) / tl,
        ),
      );
    }
    poly.push([...poly[0]]);
    polys.push(poly);
  }
  if (
    polys.some((poly) =>
      poly.some(
        ([x, y]) =>
          !Number.isFinite(x) ||
          !Number.isFinite(y) ||
          x < 0 ||
          y < 0 ||
          x > N - 1 ||
          y > N - 1,
      ),
    )
  )
    return null;
  polys.sort(
    (a, b) => a.reduce((s, p) => s + p[0], 0) - b.reduce((s, p) => s + p[0], 0),
  );
  return { polys, confidence: clamp(quality, 0, 1) };
}

function cyclicTrace(
  cost: Float32Array,
  M: number,
  S: number,
  spring: number,
  reach: number,
): Int16Array {
  let a = new Float64Array(S),
    b = new Float64Array(S);
  const back = new Int16Array(M * S),
    path = new Int16Array(M);
  let best = Infinity;
  for (let start = 0; start < S; start++) {
    a.fill(Infinity);
    a[start] = cost[start];
    for (let j = 1; j < M; j++) {
      for (let k = 0; k < S; k++) {
        let value = Infinity,
          from = 0;
        for (
          let l = Math.max(0, k - reach);
          l <= Math.min(S - 1, k + reach);
          l++
        ) {
          const z = a[l] + spring * (k - l) ** 2;
          if (z < value) {
            value = z;
            from = l;
          }
        }
        b[k] = value + cost[j * S + k];
        back[j * S + k] = from;
      }
      [a, b] = [b, a];
    }
    for (
      let end = Math.max(0, start - reach);
      end <= Math.min(S - 1, start + reach);
      end++
    ) {
      const z = a[end] + spring * (end - start) ** 2;
      if (z < best) {
        best = z;
        let k = end;
        for (let j = M - 1; j >= 0; j--) {
          path[j] = k;
          k = back[j * S + k];
        }
      }
    }
  }
  return path;
}
