export const LOADING = "@loading";
export const SPLASH = "@splash";
export const NODE_WIDTH = 240;
export const specialNode = (id) => id === LOADING || id === SPLASH;
export function flowNodes(project) {
  return [
    { id: LOADING, name: "加载", role: "loading" },
    { id: SPLASH, name: "开屏", role: "splash" },
    ...project.scenes,
  ];
}
export function flowPorts(project, node, ports) {
  if (node.id === LOADING)
    return [
      {
        path: "fixed",
        label: "加载完成",
        target: { kind: "scene", sceneId: SPLASH },
        fixed: true,
      },
    ];
  if (node.id === SPLASH)
    return [
      {
        path: "entry",
        label: "点击开始",
        target: { kind: "scene", sceneId: project.entryId },
      },
    ];
  return ports(node)
    .map((p) =>
      p.target.kind === "home"
        ? { ...p, target: { kind: "scene", sceneId: SPLASH } }
        : p,
    )
    .filter((p) => p.target.kind !== "continue" && p.target.kind !== "seek");
}
export function flowPositions(project) {
  const original = project.editor.positions,
    shift = original[LOADING] ? 0 : 640;
  const positions = Object.fromEntries(
    project.scenes.map((s, i) => [
      s.id,
      {
        x: (original[s.id]?.x ?? 60 + i * 340) + shift,
        y: original[s.id]?.y ?? 100,
      },
    ]),
  );
  const y = positions[project.entryId]?.y ?? 100;
  positions[LOADING] = original[LOADING] || { x: 60, y };
  positions[SPLASH] = original[SPLASH] || { x: 380, y };
  return positions;
}
// Remove DFS back-edges for ranking only; the actual story links remain intact.
export function arrangeFlow(project, ports, subset = null) {
  const nodes = flowNodes(project),
    ids = new Set(nodes.map((n) => n.id));
  const adjacency = new Map(
    nodes.map((n) => [
      n.id,
      [
        ...new Set(
          flowPorts(project, n, ports)
            .filter(
              (p) => p.target.kind === "scene" && ids.has(p.target.sceneId),
            )
            .map((p) => p.target.sceneId),
        ),
      ],
    ]),
  );
  const state = new Map(),
    order = [],
    forward = new Map(nodes.map((n) => [n.id, []])),
    reachable = new Set();
  const mark = (id) => {
    if (reachable.has(id)) return;
    reachable.add(id);
    for (const t of adjacency.get(id) || []) mark(t);
  };
  mark(LOADING);
  const visit = (id) => {
    if (state.get(id)) return;
    state.set(id, 1);
    for (const t of adjacency.get(id)) {
      if (state.get(t) === 1) continue;
      forward.get(id).push(t);
      visit(t);
    }
    state.set(id, 2);
    order.push(id);
  };
  visit(LOADING);
  for (const n of nodes) visit(n.id);
  order.reverse();
  const rank = new Map(nodes.map((n) => [n.id, 0]));
  for (const id of order)
    for (const t of forward.get(id))
      rank.set(t, Math.max(rank.get(t), rank.get(id) + 1));
  const heights = new Map(
    nodes.map((n) => [n.id, 170 + flowPorts(project, n, ports).length * 58]),
  );
  const columns = new Map();
  for (const n of nodes) {
    const r = rank.get(n.id);
    if (!columns.has(r)) columns.set(r, []);
    columns.get(r).push(n.id);
  }
  const result = {},
    parents = new Map(nodes.map((n) => [n.id, []]));
  for (const [id, ts] of forward) for (const t of ts) parents.get(t).push(id);
  for (const r of [...columns.keys()].sort((a, b) => a - b)) {
    let y = 100;
    const list = columns.get(r).filter((id) => reachable.has(id));
    list.sort((a, b) => {
      const avg = (id) => {
        const ps = parents.get(id).filter((p) => result[p]);
        return ps.length
          ? ps.reduce((s, p) => s + result[p].y, 0) / ps.length
          : 0;
      };
      return avg(a) - avg(b);
    });
    for (const id of list) {
      const incoming = parents.get(id).filter((p) => result[p]);
      if (incoming.length)
        y = Math.max(
          y,
          incoming.reduce((sum, p) => sum + result[p].y, 0) / incoming.length,
        );
      result[id] = { x: 60 + r * 400, y };
      y += heights.get(id) + 80;
    }
  }
  const bottom =
    Math.max(
      400,
      ...Object.entries(result).map(([id, p]) => p.y + heights.get(id)),
    ) + 160;
  let i = 0;
  for (const n of nodes)
    if (!reachable.has(n.id)) {
      result[n.id] = {
        x: 60 + (i % 4) * 360,
        y: bottom + Math.floor(i / 4) * Math.max(300, ...heights.values()),
      };
      i++;
    }
  if (!subset) return result;
  const chosen = [...subset].filter((id) => result[id]),
    old = flowPositions(project);
  if (!chosen.length) return old;
  const dx =
    Math.min(...chosen.map((id) => old[id].x)) -
    Math.min(...chosen.map((id) => result[id].x));
  const dy =
    Math.min(...chosen.map((id) => old[id].y)) -
    Math.min(...chosen.map((id) => result[id].y));
  for (const id of chosen)
    old[id] = { x: result[id].x + dx, y: result[id].y + dy };
  return old;
}
function crosses(a, b, r) {
  if (a.x === b.x)
    return (
      a.x > r.x &&
      a.x < r.x + r.w &&
      Math.max(a.y, b.y) > r.y &&
      Math.min(a.y, b.y) < r.y + r.h
    );
  return (
    a.y > r.y &&
    a.y < r.y + r.h &&
    Math.max(a.x, b.x) > r.x &&
    Math.min(a.x, b.x) < r.x + r.w
  );
}
// Axis-aligned visibility grid. Dijkstra routes around expanded card bounds.
export function routeFlow(start, end, rects, { back = false, lane = 0 } = {}) {
  const obstacles = rects.map((r) => ({
    ...r,
    x: r.x - 10,
    y: r.y - 10,
    w: r.w + 20,
    h: r.h + 20,
  }));
  const a = { x: start.x + 18, y: start.y },
    b = { x: end.x - 18, y: end.y };
  const bottom =
    Math.max(start.y, end.y, ...obstacles.map((r) => r.y + r.h)) +
    35 +
    (lane % 8) * 10;
  const xs = [
    ...new Set([
      a.x,
      b.x,
      ...obstacles.flatMap((r) => [r.x - 2, r.x + r.w + 2]),
    ]),
  ].sort((a, b) => a - b);
  const ys = [
    ...new Set([
      a.y,
      b.y,
      bottom,
      30,
      ...obstacles.flatMap((r) => [r.y - 2, r.y + r.h + 2]),
    ]),
  ].sort((a, b) => a - b);
  const clear = (a, b) => !obstacles.some((r) => crosses(a, b, r));
  if (!back) {
    const elbow = { x: b.x, y: a.y };
    if (clear(a, elbow) && clear(elbow, b)) return [start, a, elbow, b, end];
  }
  // Backward links take a dedicated outside lane, routing each leg through the same grid.
  const find = (from, to) => {
    const W = xs.length,
      H = ys.length,
      index = (x, y) => y * W + x;
    const si = index(xs.indexOf(from.x), ys.indexOf(from.y)),
      ti = index(xs.indexOf(to.x), ys.indexOf(to.y));
    const dist = new Map([[si, 0]]),
      prev = new Map(),
      heap = [[0, si]],
      closed = new Set();
    const push = (v) => {
      heap.push(v);
      let i = heap.length - 1;
      while (i) {
        const p = (i - 1) >> 1;
        if (heap[p][0] <= v[0]) break;
        heap[i] = heap[p];
        i = p;
      }
      heap[i] = v;
    };
    const pop = () => {
      const min = heap[0],
        last = heap.pop();
      if (heap.length) {
        let i = 0;
        while (i * 2 + 1 < heap.length) {
          let c = i * 2 + 1;
          if (c + 1 < heap.length && heap[c + 1][0] < heap[c][0]) c++;
          if (heap[c][0] >= last[0]) break;
          heap[i] = heap[c];
          i = c;
        }
        heap[i] = last;
      }
      return min;
    };
    while (heap.length) {
      const [d, id] = pop();
      if (closed.has(id)) continue;
      closed.add(id);
      if (id === ti) break;
      const x = id % W,
        y = Math.floor(id / W),
        p = { x: xs[x], y: ys[y] };
      for (const [nx, ny] of [
        [x - 1, y],
        [x + 1, y],
        [x, y - 1],
        [x, y + 1],
      ]) {
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const q = { x: xs[nx], y: ys[ny] },
          ni = index(nx, ny);
        if (!clear(p, q)) continue;
        const nd = d + Math.abs(p.x - q.x) + Math.abs(p.y - q.y);
        if (nd < (dist.get(ni) ?? Infinity)) {
          dist.set(ni, nd);
          prev.set(ni, id);
          push([nd, ni]);
        }
      }
    }
    if (!dist.has(ti))
      return [from, { x: from.x, y: bottom }, { x: to.x, y: bottom }, to];
    const path = [];
    for (let id = ti; id !== undefined; id = prev.get(id))
      path.push({ x: xs[id % W], y: ys[Math.floor(id / W)] });
    return path.reverse();
  };
  const points = back
    ? [
        ...find(a, { x: a.x, y: bottom }),
        ...find({ x: a.x, y: bottom }, { x: b.x, y: bottom }).slice(1),
        ...find({ x: b.x, y: bottom }, b).slice(1),
      ]
    : find(a, b);
  const out = [start, ...points, end];
  return out.filter(
    (p, i) =>
      !i ||
      i === out.length - 1 ||
      !(
        (out[i - 1].x === p.x && p.x === out[i + 1].x) ||
        (out[i - 1].y === p.y && p.y === out[i + 1].y)
      ),
  );
}
export const pathData = (points) =>
  points.map((p, i) => (i ? "L" : "M") + p.x + "," + p.y).join(" ");

// Common return destinations have a discoverable local shortcut instead of a long wire.
export function shortcutTarget(project, target) {
  if (target.kind !== "scene") return false;
  if (target.sceneId === SPLASH) return true;
  const node = project.scenes.find((n) => n.id === target.sceneId);
  if (node?.role !== "death") return false;
  return true;
}
export function curveFlow(start, end, rects = [], options = {}) {
  const gap = end.x - start.x;
  const corridor = rects.some(
    (r) =>
      r.x > start.x &&
      r.x + r.w < end.x &&
      r.y < Math.max(start.y, end.y) + 20 &&
      r.y + r.h > Math.min(start.y, end.y) - 20,
  );
  if (gap > 40 && !corridor) {
    const bend = Math.max(45, gap * 0.48);
    return `M${start.x},${start.y} C${start.x + bend},${start.y} ${end.x - bend},${end.y} ${end.x},${end.y}`;
  }
  const points = routeFlow(start, end, rects, options);
  let d = `M${points[0].x},${points[0].y}`;
  for (let i = 1; i < points.length - 1; i++) {
    const a = points[i - 1],
      b = points[i],
      c = points[i + 1];
    const l1 = Math.hypot(b.x - a.x, b.y - a.y),
      l2 = Math.hypot(c.x - b.x, c.y - b.y);
    const radius = Math.min(8, l1 / 2, l2 / 2);
    if (!radius) continue;
    d += ` L${b.x - ((b.x - a.x) * radius) / l1},${b.y - ((b.y - a.y) * radius) / l1} Q${b.x},${b.y} ${b.x + ((c.x - b.x) * radius) / l2},${b.y + ((c.y - b.y) * radius) / l2}`;
  }
  return d + ` L${end.x},${end.y}`;
}
