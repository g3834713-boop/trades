import { Resvg } from '@resvg/resvg-js';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FONT_PATH = path.join(__dirname, '..', 'assets', 'Inter-Bold.ttf');

const BRAND_BLUE = '#4361ee';
const SIZE = 900;

function escapeXml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));
}

// Renders a branded "Task #N" number card as a PNG buffer - loads its own bundled
// font file rather than relying on system fonts, since most Linux hosting (Render
// included) ships with none installed by default and text would otherwise render blank.
export function renderTaskNumberCard(taskNumber, label) {
  const numberText = String(taskNumber);
  const fontSize = numberText.length > 1 ? 320 : 460;

  const svg = `
    <svg width="${SIZE}" height="${SIZE}" xmlns="http://www.w3.org/2000/svg">
      <rect width="${SIZE}" height="${SIZE}" fill="${BRAND_BLUE}"/>
      <text x="${SIZE - 60}" y="90" font-family="Inter" font-weight="700" font-size="40" fill="#ffffff" fill-opacity="0.92" text-anchor="end">DailyTrade</text>
      <text x="${SIZE / 2}" y="${SIZE / 2 + 40}" font-family="Inter" font-weight="700" font-size="${fontSize}" fill="#ffffff" text-anchor="middle" dominant-baseline="middle">${escapeXml(numberText)}</text>
      <text x="60" y="${SIZE - 60}" font-family="Inter" font-weight="700" font-size="34" fill="#ffffff" fill-opacity="0.92">${escapeXml(label)}</text>
    </svg>
  `.trim();

  const resvg = new Resvg(svg, {
    font: {
      fontFiles: [FONT_PATH],
      loadSystemFonts: false,
      defaultFontFamily: 'Inter'
    }
  });

  return resvg.render().asPng();
}
