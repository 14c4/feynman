import { inlineRuns, parseMarkdown, type InlineRun } from './markdown.js';

// A minimal PDF writer for the review sheet. It lays out the same parsed Markdown the page shows,
// using the PDF standard fonts (no embedded fonts, no dependencies). Characters outside the
// standard fonts' WinAnsi encoding are written as readable ASCII (≤ → "<=", √ → "sqrt", x₂ → "x2").

type Style = InlineRun['style'];
const FONT: Record<Style, string> = { normal: 'F1', bold: 'F2', italic: 'F3', code: 'F4' };

// Adobe font metrics (1/1000 em) for ASCII 32–126. Helvetica-Oblique shares Helvetica's widths; Courier is fixed at 600.
const HELVETICA = [278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556, 1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556, 333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584];
const HELVETICA_BOLD = [278, 333, 474, 556, 556, 889, 722, 238, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 333, 333, 584, 584, 584, 611, 975, 722, 722, 722, 722, 667, 611, 778, 722, 278, 556, 722, 611, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 333, 278, 333, 584, 556, 333, 556, 611, 556, 611, 556, 333, 611, 611, 278, 278, 556, 278, 889, 611, 611, 611, 611, 389, 556, 333, 611, 556, 778, 556, 556, 500, 389, 280, 389, 584];
/** Widths for the common non-ASCII WinAnsi bytes; other accented letters are close to 556. */
const HIGH: Record<number, number> = { 0x85: 1000, 0x91: 222, 0x92: 222, 0x93: 333, 0x94: 333, 0x95: 350, 0x96: 556, 0x97: 1000, 0xb0: 400, 0xb1: 584, 0xb2: 333, 0xb3: 333, 0xb5: 556, 0xb7: 278, 0xb9: 333, 0xd7: 584, 0xf7: 584, 0xa0: 278 };

const WIN_ANSI: Record<string, number> = { '€': 0x80, '‚': 0x82, 'ƒ': 0x83, '„': 0x84, '…': 0x85, '†': 0x86, '‡': 0x87, 'ˆ': 0x88, '‰': 0x89, 'Š': 0x8a, '‹': 0x8b, 'Œ': 0x8c, 'Ž': 0x8e, '‘': 0x91, '’': 0x92, '“': 0x93, '”': 0x94, '•': 0x95, '–': 0x96, '—': 0x97, '˜': 0x98, '™': 0x99, 'š': 0x9a, '›': 0x9b, 'œ': 0x9c, 'ž': 0x9e, 'Ÿ': 0x9f };
const FALLBACK: Record<string, string> = {
  '→': '->', '←': '<-', '⇒': '=>', '⇐': '<=', '↔': '<->', '⇔': '<=>', '≤': '<=', '≥': '>=', '≠': '!=', '≈': '~', '≡': '===', '√': 'sqrt', '∞': 'infinity',
  '∑': 'sum', 'Σ': 'Sigma', '∫': 'integral', '∂': 'd', '∆': 'Delta', 'Δ': 'Delta', 'π': 'pi', 'θ': 'theta', 'α': 'alpha', 'β': 'beta', 'γ': 'gamma', 'λ': 'lambda', 'μ': 'µ', 'σ': 'sigma', 'ω': 'omega', 'Ω': 'Omega',
  '−': '-', '∙': '·', '⋅': '·', '∗': '*', '✓': '(ok)', '✔': '(ok)', '✗': 'x', '′': "'", '″': '"', '⁰': '^0', '⁴': '^4', '⁵': '^5', '⁶': '^6', '⁷': '^7', '⁸': '^8', '⁹': '^9', 'ⁿ': '^n', '⁺': '^+', '⁻': '^-',
  '₀': '0', '₁': '1', '₂': '2', '₃': '3', '₄': '4', '₅': '5', '₆': '6', '₇': '7', '₈': '8', '₉': '9', '₊': '+', '₋': '-', ' ': ' ', ' ': ' ', ' ': ' ',
};

/** Unicode text as WinAnsi byte values. */
export function winAnsi(text: string): number[] {
  const bytes: number[] = [];
  for (const char of text) {
    const code = char.codePointAt(0)!;
    if ((code >= 32 && code <= 126) || (code >= 0xa0 && code <= 0xff)) { bytes.push(code); continue; }
    if (WIN_ANSI[char] !== undefined) { bytes.push(WIN_ANSI[char]); continue; }
    if (char === '\t') { bytes.push(32); continue; }
    const fallback = FALLBACK[char] ?? char.normalize('NFKD').replace(/[̀-ͯ]/g, '');
    if (fallback !== char && fallback) { bytes.push(...winAnsi(fallback)); continue; }
    if (code < 32) continue;
    bytes.push(63); // "?"
  }
  return bytes;
}

function widthOf(bytes: number[], style: Style, size: number): number {
  if (style === 'code') return bytes.length * 600 * size / 1000;
  const table = style === 'bold' ? HELVETICA_BOLD : HELVETICA;
  return bytes.reduce((sum, byte) => sum + (byte >= 32 && byte <= 126 ? table[byte - 32]! : HIGH[byte] ?? 556), 0) * size / 1000;
}

const hex = (bytes: number[]) => `<${bytes.map((byte) => byte.toString(16).padStart(2, '0')).join('')}>`;
const num = (value: number) => Number(value.toFixed(2)).toString();

const PAGE = { width: 595.28, height: 841.89, left: 56, right: 56, top: 60, bottom: 64 };
const TEXT_WIDTH = PAGE.width - PAGE.left - PAGE.right;
const INK = '0.094 0.125 0.106'; const MUTED = '0.33 0.39 0.35'; const ACCENT = '0.122 0.353 0.227';

interface Word { bytes: number[]; style: Style; space: boolean }
interface Line { words: Word[] }

function words(runs: InlineRun[], force?: Style): Word[] {
  const result: Word[] = []; let pendingSpace = false;
  for (const run of runs) {
    for (const piece of run.text.split(/(\s+)/)) {
      if (!piece) continue;
      if (/^\s+$/.test(piece)) { pendingSpace = true; continue; }
      result.push({ bytes: winAnsi(piece), style: force ?? run.style, space: pendingSpace }); pendingSpace = false;
    }
  }
  return result;
}

function wrap(items: Word[], size: number, width: number): Line[] {
  const lines: Line[] = []; let current: Word[] = []; let used = 0;
  const space = (style: Style) => widthOf([32], style, size);
  for (let word of items) {
    let wordWidth = widthOf(word.bytes, word.style, size);
    // A word longer than the line is split across lines.
    while (wordWidth > width && word.bytes.length > 1) {
      if (current.length) { lines.push({ words: current }); current = []; used = 0; }
      let count = word.bytes.length; while (count > 1 && widthOf(word.bytes.slice(0, count), word.style, size) > width) count--;
      lines.push({ words: [{ ...word, bytes: word.bytes.slice(0, count), space: false }] });
      word = { ...word, bytes: word.bytes.slice(count), space: false }; wordWidth = widthOf(word.bytes, word.style, size);
    }
    const gap = current.length && word.space ? space(word.style) : 0;
    if (current.length && used + gap + wordWidth > width) { lines.push({ words: current }); current = [{ ...word, space: false }]; used = wordWidth; continue; }
    current.push(current.length ? word : { ...word, space: false }); used += gap + wordWidth;
  }
  if (current.length) lines.push({ words: current });
  return lines;
}

/** Lays the review sheet's Markdown out as a multi-page A4 PDF and returns the file bytes. */
export function reviewPdf(markdown: string, title: string): Uint8Array {
  const pages: string[][] = []; let ops: string[] = []; let y = 0;
  const newPage = () => { ops = []; pages.push(ops); y = PAGE.height - PAGE.top; };
  newPage();
  const ensure = (height: number) => { if (y - height < PAGE.bottom) newPage(); };
  const drawLine = (line: Line, x: number, size: number, color: string) => {
    let cursor = x; ops.push(`${color} rg`);
    for (const word of line.words) {
      if (word.space) cursor += widthOf([32], word.style, size);
      ops.push(`BT /${FONT[word.style]} ${num(size)} Tf 1 0 0 1 ${num(cursor)} ${num(y)} Tm ${hex(word.bytes)} Tj ET`);
      cursor += widthOf(word.bytes, word.style, size);
    }
  };
  /** Writes wrapped text lines; `bar` draws the quote rule beside each line so it continues across pages. */
  const text = (sourceLines: string[], options: { size: number; x?: number; color?: string; force?: Style; bar?: boolean; marker?: string; after?: number }) => {
    const x = options.x ?? PAGE.left; const leading = options.size * 1.45; let first = true;
    for (const source of sourceLines) {
      for (const line of wrap(words(inlineRuns(source), options.force), options.size, TEXT_WIDTH - (x - PAGE.left))) {
        ensure(leading); y -= leading;
        if (options.bar) ops.push(`0.56 0.72 0.62 RG 2 w ${num(x - 10)} ${num(y - options.size * 0.35)} m ${num(x - 10)} ${num(y + leading - options.size * 0.35)} l S`);
        if (first && options.marker) { ops.push(`${INK} rg BT /F1 ${num(options.size)} Tf 1 0 0 1 ${num(x - 16)} ${num(y)} Tm ${hex(winAnsi(options.marker))} Tj ET`); }
        drawLine(line, x, options.size, options.color ?? INK); first = false;
      }
    }
    y -= options.after ?? 6;
  };

  const SIZES = [0, 20, 15.5, 13, 11.5, 11, 11];
  for (const block of parseMarkdown(markdown)) {
    if (block.kind === 'heading') {
      const size = SIZES[block.level]!;
      y -= block.level <= 2 ? 10 : 8;
      ensure(size * 1.45 + 40); // keep a heading with the text that follows it
      text([block.text], { size, force: 'bold', color: block.level === 3 || block.level === 4 ? ACCENT : INK, after: 4 });
    } else if (block.kind === 'paragraph') text(block.lines, { size: 10.5 });
    else if (block.kind === 'quote') { for (const paragraph of block.paragraphs) text(paragraph, { size: 10.5, x: PAGE.left + 14, color: MUTED, bar: true, after: 2 }); y -= 4; }
    else { block.items.forEach((item, index) => text(item.split('\n'), { size: 10.5, x: PAGE.left + 18, marker: block.ordered ? `${block.start + index}.` : '•', after: 2 })); y -= 4; }
  }

  // Footer on every page.
  pages.forEach((page, index) => {
    const footer = winAnsi(`${title} · page ${index + 1} of ${pages.length}`);
    page.push(`${MUTED} rg BT /F1 8 Tf 1 0 0 1 ${num(PAGE.left)} 32 Tm ${hex(footer)} Tj ET`);
  });

  // Serialize: catalog, page tree, four standard fonts, info, then a page and content stream per page.
  const objects: string[] = [];
  const fonts = ['Helvetica', 'Helvetica-Bold', 'Helvetica-Oblique', 'Courier'];
  const pageIds = pages.map((_, index) => 8 + index * 2);
  objects[1] = '<< /Type /Catalog /Pages 2 0 R >>';
  objects[2] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pages.length} >>`;
  fonts.forEach((font, index) => { objects[3 + index] = `<< /Type /Font /Subtype /Type1 /BaseFont /${font} /Encoding /WinAnsiEncoding >>`; });
  const utf16 = [0xfe, 0xff, ...title.split('').flatMap((unit) => { const code = unit.charCodeAt(0); return [code >> 8, code & 0xff]; })];
  objects[7] = `<< /Title ${hex(utf16)} /Producer (feynman.ai) >>`;
  pages.forEach((page, index) => {
    const content = page.join('\n');
    objects[pageIds[index]!] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE.width} ${PAGE.height}] /Resources << /Font << /F1 3 0 R /F2 4 0 R /F3 5 0 R /F4 6 0 R >> >> /Contents ${pageIds[index]! + 1} 0 R >>`;
    objects[pageIds[index]! + 1] = `<< /Length ${content.length} >>\nstream\n${content}\nendstream`;
  });
  let file = '%PDF-1.4\n'; const offsets: number[] = [];
  for (let id = 1; id < objects.length; id++) { offsets[id] = file.length; file += `${id} 0 obj\n${objects[id]}\nendobj\n`; }
  const xref = file.length;
  file += `xref\n0 ${objects.length}\n0000000000 65535 f \n${offsets.slice(1).map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}`;
  file += `trailer\n<< /Size ${objects.length} /Root 1 0 R /Info 7 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  // Every character above is ASCII (text is hex-encoded), so string length equals byte offset.
  return new TextEncoder().encode(file);
}
