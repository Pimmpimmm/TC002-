import fs from 'node:fs';
import path from 'node:path';

const WIDTH = 52;
const HEIGHT = 16;
const SCALE = 12;
const BLACK = [0, 0, 0];
const DIM = [18, 18, 18];
const READY = [255, 255, 255];
const FOCUS = [40, 230, 110];
const REST = [40, 120, 255];
const TEXT = [225, 235, 255];

const digits = [
  [0x0e, 0x11, 0x13, 0x15, 0x19, 0x11, 0x0e],
  [0x04, 0x0c, 0x04, 0x04, 0x04, 0x04, 0x0e],
  [0x0e, 0x11, 0x01, 0x02, 0x04, 0x08, 0x1f],
  [0x1e, 0x01, 0x01, 0x0e, 0x01, 0x01, 0x1e],
  [0x02, 0x06, 0x0a, 0x12, 0x1f, 0x02, 0x02],
  [0x1f, 0x10, 0x10, 0x1e, 0x01, 0x01, 0x1e],
  [0x0e, 0x10, 0x10, 0x1e, 0x11, 0x11, 0x0e],
  [0x1f, 0x01, 0x02, 0x04, 0x08, 0x08, 0x08],
  [0x0e, 0x11, 0x11, 0x0e, 0x11, 0x11, 0x0e],
  [0x0e, 0x11, 0x11, 0x0f, 0x01, 0x01, 0x0e]
];

const letters = {
  A: [0b010, 0b101, 0b111, 0b101, 0b101], C: [0b011, 0b100, 0b100, 0b100, 0b011],
  D: [0b110, 0b101, 0b101, 0b101, 0b110], E: [0b111, 0b100, 0b110, 0b100, 0b111],
  F: [0b111, 0b100, 0b110, 0b100, 0b100], N: [0b101, 0b111, 0b111, 0b111, 0b101],
  O: [0b010, 0b101, 0b101, 0b101, 0b010], R: [0b110, 0b101, 0b110, 0b101, 0b101],
  S: [0b011, 0b100, 0b010, 0b001, 0b110], U: [0b101, 0b101, 0b101, 0b101, 0b111],
  T: [0b111, 0b010, 0b010, 0b010, 0b010],
  Y: [0b101, 0b101, 0b010, 0b010, 0b010]
};

// Completion prompts use the same 3x7 pair glyphs as FocusPage.cpp. Each
// source pixel is enlarged to a 2x2 LED cell, leaving only the outer border.
const promptGlyphs = {
  GO: [0x77, 0x45, 0x45, 0x55, 0x55, 0x55, 0x77],
  RE: [0x67, 0x54, 0x54, 0x66, 0x54, 0x54, 0x57],
  ST: [0x77, 0x42, 0x42, 0x72, 0x12, 0x12, 0x72],
  WO: [0x57, 0x55, 0x55, 0x75, 0x75, 0x75, 0x27],
  RK: [0x65, 0x55, 0x56, 0x64, 0x56, 0x55, 0x55]
};

function render({ seconds, phase }) {
  const pixels = Array.from({ length: HEIGHT }, () => Array.from({ length: WIDTH }, () => [...BLACK]));
  const set = (x, y, color) => { if (x >= 0 && x < WIDTH && y >= 0 && y < HEIGHT) pixels[y][x] = color; };
  const line = (x0, y0, x1, y1, color) => {
    let dx = Math.abs(x1 - x0), sx = x0 < x1 ? 1 : -1;
    let dy = -Math.abs(y1 - y0), sy = y0 < y1 ? 1 : -1, error = dx + dy;
    while (true) {
      set(x0, y0, color);
      if (x0 === x1 && y0 === y1) break;
      const twice = 2 * error;
      if (twice >= dy) { error += dy; x0 += sx; }
      if (twice <= dx) { error += dx; y0 += sy; }
    }
  };
  let accent = phase === 'FOCUS' ? FOCUS : (phase === 'REST' ? REST : READY);

  if (phase === 'FOCUS_DONE' || phase === 'REST_DONE') {
    const prompt = phase === 'FOCUS_DONE'
      ? [promptGlyphs.GO, promptGlyphs.RE, promptGlyphs.ST]
      : [promptGlyphs.GO, promptGlyphs.WO, promptGlyphs.RK];
    const promptColor = phase === 'FOCUS_DONE' ? REST : FOCUS;
    const scale = 2;
    const blockWidth = 7 * scale;
    const gap = 4;
    const startX = Math.floor((WIDTH - (prompt.length * blockWidth + (prompt.length - 1) * gap)) / 2);
    for (let index = 0; index < prompt.length; index += 1) {
      for (let row = 0; row < 7; row += 1) for (let column = 0; column < 7; column += 1) {
        if (!(prompt[index][row] & (1 << (6 - column)))) continue;
        for (let dy = 0; dy < scale; dy += 1) for (let dx = 0; dx < scale; dx += 1) {
          set(startX + index * (blockWidth + gap) + column * scale + dx, 1 + row * scale + dy, promptColor);
        }
      }
    }
    return pixels;
  }

  if (phase === 'REST') {
    line(2, 4, 8, 4, accent); line(2, 4, 2, 9, accent); line(2, 9, 8, 9, accent);
    line(8, 4, 8, 9, accent); line(9, 5, 11, 5, accent); line(11, 5, 11, 8, accent);
    line(9, 8, 11, 8, accent); set(4, 2, accent); set(6, 1, accent);
  } else {
    const circle = [[6,1],[3,2],[4,2],[5,2],[7,2],[8,2],[9,2],[2,3],[10,3],[1,4],[11,4],[1,5],[11,5],[1,6],[11,6],[1,7],[11,7],[1,8],[11,8],[2,9],[10,9],[3,10],[4,10],[5,10],[7,10],[8,10],[9,10],[6,11]];
    for (const [x, y] of circle) set(x, y, accent);
    line(6, 6, 6, 3, accent); line(6, 6, 9, 6, accent);
  }

  const value = Math.max(0, Math.min(seconds, 99 * 60 + 59));
  const minutes = Math.floor(value / 60), secs = value % 60;
  const values = [Math.floor(minutes / 10), minutes % 10, Math.floor(secs / 10), secs % 10];
  const numberColor = phase === 'READY' ? TEXT : accent;
  let x = 20;
  for (let index = 0; index < values.length; index += 1) {
    for (let row = 0; row < 7; row += 1) for (let column = 0; column < 5; column += 1) {
      if (digits[values[index]][row] & (1 << (4 - column))) set(x + column, 1 + row, numberColor);
    }
    x += 6;
    if (index === 1) { set(x, 3, numberColor); set(x, 6, numberColor); x += 3; }
  }

  const label = phase;
  const labelWidth = label.length * 4 - 1;
  x = 33 - Math.floor(labelWidth / 2);
  for (const character of label) {
    const glyph = letters[character];
    for (let row = 0; row < 5; row += 1) for (let column = 0; column < 3; column += 1) {
      if (glyph[row] & (1 << (2 - column))) set(x + column, 9 + row, accent);
    }
    x += 4;
  }

  for (let column = 1; column <= 50; column += 1) set(column, 15, DIM);
  if (phase !== 'READY' && value > 0) {
    const total = phase === 'REST' ? 300 : 2700;
    const fill = Math.ceil(value * 50 / total);
    for (let column = 1; column <= fill; column += 1) set(column, 15, accent);
  }
  return pixels;
}

function savePpm(file, pixels) {
  const width = WIDTH * SCALE, height = HEIGHT * SCALE;
  const body = Buffer.alloc(width * height * 3);
  let offset = 0;
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
    const color = pixels[Math.floor(y / SCALE)][Math.floor(x / SCALE)];
    body[offset++] = color[0]; body[offset++] = color[1]; body[offset++] = color[2];
  }
  fs.writeFileSync(file, Buffer.concat([Buffer.from(`P6\n${width} ${height}\n255\n`), body]));
}

const output = path.resolve('device/TC002_Focus_Probe/previews');
fs.mkdirSync(output, { recursive: true });
for (const item of [
  ['ready', { seconds: 2700, phase: 'READY' }],
  ['active', { seconds: 2699, phase: 'FOCUS' }],
  ['last-minute', { seconds: 29, phase: 'FOCUS' }],
  ['rest', { seconds: 299, phase: 'REST' }],
  ['done', { seconds: 0, phase: 'FOCUS_DONE' }],
  ['rest-done', { seconds: 0, phase: 'REST_DONE' }]
]) savePpm(path.join(output, `focus-${item[0]}.ppm`), render(item[1]));

console.log(output);
