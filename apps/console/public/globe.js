export function drawGlobe(target, { cx, cy, R, rows, clip }) {
  const parts = [];
  for (let lat = 0; lat < rows; lat++) {
    const ry = R * (0.12 + lat * 0.1);
    for (let i = 0; i <= 90; i++) {
      const t = Math.PI + (i / 90) * Math.PI;
      const x = cx + R * Math.cos(t);
      const y = cy + ry * Math.sin(t);
      if (y < clip) parts.push(`<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r=".9" fill="#b7c3d6" opacity="${(0.2 + lat * 0.06).toFixed(2)}"/>`);
    }
  }
  target.innerHTML = parts.join("");
}
