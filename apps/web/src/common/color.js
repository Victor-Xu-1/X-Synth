/*
 * Color utility functions
 */

const colorMap = [
  "#EE7733",
  "#0077BB",
  "#33BBEE",
  "#EE3377",
  "#CC3311",
  "#009988",
  "#BBBBBB",
];

function interpolateHexColor(palette, value) {
  // Interpolate between colors in palette at the specified value
  // Palette colors should be arrays of rgb hex strings
  const rgbPalette = palette.map(hex2rgb);
  return rgb2hex(interpolateColor(rgbPalette, value));
}

function interpolateColor(palette, value) {
  // Interpolate between colors in palette at the specified value
  // Palette colors should be arrays of rgb decimal values
  if (value <= 0) return palette[0];
  if (value >= 1) return palette[palette.length - 1];
  if (value < 0 || value > 1)
    throw new Error("Value should be between 0 and 1!");

  const interval = 1 / (palette.length - 1);
  const start = Math.floor(value / interval);
  const end = Math.min(start + 1, palette.length - 1);
  const startColor = palette[start];
  const endColor = palette[end];
  const x = [start * interval, end * interval];

  return startColor.map((_, i) => {
    const y = [startColor[i], endColor[i]];
    return Math.round(interpolate(x, y, value));
  });
}

function interpolate(x, y, xn) {
  // x is array of 2 x values
  // y is array of 2 y values
  // xn is the new x for which to determine the value of y
  return y[0] + ((xn - x[0]) * (y[1] - y[0])) / (x[1] - x[0]);
}

function hex2rgb(hex) {
  // Converts rgb hex string to decimal values
  hex = hex.replace("#", "");
  if (hex.length !== 6)
    throw new Error("Only 6 character color hex strings supported!");
  return [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16));
}

function rgb2hex(rgb) {
  // Converts array of rgb decimal values to hex string
  if (rgb.length !== 3)
    throw new Error("Only three element rgb values supported!");
  return `#${rgb.map((i) => i.toString(16).padStart(2, "0")).join("")}`;
}

export { colorMap, interpolateHexColor };
