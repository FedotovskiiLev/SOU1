// SPDX-License-Identifier: AGPL-3.0-only
// Each glyph is placed independently. Android font fallback cannot stretch rows.
export function drawAsciiGrid(canvas, text, columns, rows, color) {
  const context = canvas.getContext('2d');
  const dx = canvas.width / columns, dy = canvas.height / rows;
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = color;
  context.font = `${Math.min(dx * 1.5, dy)}px monospace`;
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  const lines = text.split('\n');
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < columns; x++) {
      const glyph = lines[y]?.[x];
      if (glyph && glyph !== ' ') context.fillText(glyph, (x + .5) * dx, (y + .5) * dy, dx);
    }
  }
}
