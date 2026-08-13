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

const CARD_BG = '#121214';
const HEADER_GRAY = '#9ca3af';
const DIVIDER = '#2a2a2e';
const TABLE_WIDTH = 1000;
const ROW_HEIGHT = 62;
const HEADER_BASELINE_Y = 96;
const FIRST_ROW_Y = 150;
const MAX_ROWS = 15;

function formatAmount(n) {
  return Number(n).toLocaleString('en-US', { maximumFractionDigits: 2 });
}

// Renders the teller/product package table as a branded card - own dark layout and
// DailyTrade wordmark, not the third-party "timely"/"earn" template it was modeled
// after. Package rows come from live price/commission data, same as the text caption.
export function renderTellerPackageCard(taskNumber, tellerProducts) {
  const allRows = tellerProducts || [];
  const rows = allRows.slice(0, MAX_ROWS);
  const truncated = allRows.length > MAX_ROWS;

  if (rows.length === 0) {
    const height = 260;
    const svg = `
      <svg width="${TABLE_WIDTH}" height="${height}" xmlns="http://www.w3.org/2000/svg">
        <rect width="${TABLE_WIDTH}" height="${height}" fill="${CARD_BG}"/>
        <circle cx="46" cy="40" r="13" fill="${BRAND_BLUE}"/>
        <text x="74" y="49" font-family="Inter" font-weight="700" font-size="32" fill="#ffffff">Teller Network - Task Packages</text>
        <text x="${TABLE_WIDTH - 40}" y="44" font-family="Inter" font-weight="700" font-size="22" fill="#ffffff" fill-opacity="0.75" text-anchor="end">DailyTrade | Task #${escapeXml(taskNumber)}</text>
        <line x1="40" y1="78" x2="${TABLE_WIDTH - 40}" y2="78" stroke="${DIVIDER}" stroke-width="1.5"/>
        <text x="${TABLE_WIDTH / 2}" y="${height / 2 + 30}" font-family="Inter" font-weight="500" font-size="24" fill="${HEADER_GRAY}" text-anchor="middle">No packages currently available</text>
      </svg>
    `.trim();
    const resvg = new Resvg(svg, { font: { fontFiles: [FONT_PATH], loadSystemFonts: false, defaultFontFamily: 'Inter' } });
    return resvg.render().asPng();
  }

  const rowLines = rows.map((p, i) => {
    const y = FIRST_ROW_Y + i * ROW_HEIGHT;
    const sep = i > 0
      ? `<line x1="60" y1="${y - ROW_HEIGHT / 2}" x2="${TABLE_WIDTH - 60}" y2="${y - ROW_HEIGHT / 2}" stroke="${DIVIDER}" stroke-width="1"/>`
      : '';
    return `${sep}
      <text x="60" y="${y}" font-family="Inter" font-weight="700" font-size="27" fill="#ffffff">${escapeXml(formatAmount(p.amount))}</text>
      <text x="400" y="${y}" font-family="Inter" font-weight="500" font-size="24" fill="#d1d5db">${escapeXml(formatAmount(p.profit))} (${escapeXml(p.commissionPercent)}%)</text>
      <text x="700" y="${y}" font-family="Inter" font-weight="700" font-size="27" fill="#ffffff">${escapeXml(formatAmount(p.totalReturn))}</text>`;
  }).join('\n');

  const height = FIRST_ROW_Y + rows.length * ROW_HEIGHT + (truncated ? 60 : 30);
  const footNote = truncated
    ? `<text x="${TABLE_WIDTH / 2}" y="${height - 26}" font-family="Inter" font-weight="500" font-size="20" fill="${HEADER_GRAY}" text-anchor="middle">+ ${allRows.length - MAX_ROWS} more package(s) - see full list on the site</text>`
    : '';

  const svg = `
    <svg width="${TABLE_WIDTH}" height="${height}" xmlns="http://www.w3.org/2000/svg">
      <rect width="${TABLE_WIDTH}" height="${height}" fill="${CARD_BG}"/>
      <circle cx="46" cy="40" r="13" fill="${BRAND_BLUE}"/>
      <text x="74" y="49" font-family="Inter" font-weight="700" font-size="32" fill="#ffffff">Teller Network - Task Packages</text>
      <text x="${TABLE_WIDTH - 40}" y="44" font-family="Inter" font-weight="700" font-size="22" fill="#ffffff" fill-opacity="0.75" text-anchor="end">DailyTrade | Task #${escapeXml(taskNumber)}</text>
      <line x1="40" y1="78" x2="${TABLE_WIDTH - 40}" y2="78" stroke="${DIVIDER}" stroke-width="1.5"/>
      <text x="60" y="${HEADER_BASELINE_Y}" font-family="Inter" font-weight="600" font-size="22" fill="${HEADER_GRAY}">AMOUNT (GHC)</text>
      <text x="400" y="${HEADER_BASELINE_Y}" font-family="Inter" font-weight="600" font-size="22" fill="${HEADER_GRAY}">PROFIT</text>
      <text x="700" y="${HEADER_BASELINE_Y}" font-family="Inter" font-weight="600" font-size="22" fill="${HEADER_GRAY}">TOTAL RETURN</text>
      <line x1="40" y1="${HEADER_BASELINE_Y + 22}" x2="${TABLE_WIDTH - 40}" y2="${HEADER_BASELINE_Y + 22}" stroke="${DIVIDER}" stroke-width="1"/>
      ${rowLines}
      ${footNote}
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
