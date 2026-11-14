const sub = (a, b) => a.map((v, i) => v - b[i]), dot = (a, b) => a.reduce((sum, v, i) => sum + v * b[i], 0),
  clamp = x => Math.max(0, Math.min(1, x))

// Минимум по двум конечным отрезкам, включая конечные суставы.
export function segmentDistance(p, q, r, s) {
  const u = sub(q, p), v = sub(s, r), w = sub(p, r), a = dot(u, u), b = dot(u, v),
    c = dot(v, v), d = dot(u, w), e = dot(v, w), den = a * c - b * b
  let t = den > 1e-12 ? clamp((b * e - c * d) / den) : 0, z = (b * t + e) / c
  if (z < 0) { z = 0; t = clamp(-d / a) }
  else if (z > 1) { z = 1; t = clamp((b - d) / a) }
  return Math.hypot(...w.map((n, i) => n + t * u[i] - z * v[i]))
}
