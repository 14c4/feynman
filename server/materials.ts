import { randomUUID } from 'node:crypto';
import { MATERIAL_LIMITS, type StudyMaterial } from '../shared/types.js';
import { PracticeError } from './domain.js';

// Uploaded study material is untrusted reference text. It is extracted here,
// stored privately with the session record, and only bounded excerpts are sent
// to providers, always as data rather than instructions.
export interface PrivateMaterial { id: string; name: string; text: string }
export interface ExtractedMaterial { meta: StudyMaterial; text: string }

/** Characters kept per file after extraction. */
export const STORED_CHARACTERS = 60_000;
/** Excerpt budgets for provider calls. */
export const EXCERPT_CHARACTERS = { preparation: 24_000, conversation: 4_000, voice: 1_500 } as const;
const MINIMUM_READABLE = 40;

const fail = (message: string) => new PracticeError(message, 422, 'INVALID_MATERIAL');

function safeName(value: unknown): string {
  const name = typeof value === 'string' ? value.split(/[\\/]/).pop() ?? '' : '';
  // eslint-disable-next-line no-control-regex -- stripping control characters is intended
  const clean = name.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 120);
  if (!clean) throw fail('Each uploaded file needs a name.');
  return clean;
}

export function normalizeText(value: string): string {
  return value.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n')
    // Keep tabs and newlines; drop other control characters.
    // eslint-disable-next-line no-control-regex -- intended
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
    .replace(/[ \t\u00a0]+/g, ' ').replace(/ *\n */g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

async function pdfText(bytes: Buffer, name: string): Promise<{ text: string; pages: number }> {
  const { getDocumentProxy, extractText } = await import('unpdf');
  try {
    const pdf = await getDocumentProxy(new Uint8Array(bytes), { verbosity: 0 });
    const { totalPages, text } = await extractText(pdf, { mergePages: true });
    return { text, pages: totalPages };
  } catch (error) {
    const kind = error instanceof Error ? error.name : '';
    if (kind === 'PasswordException') throw fail(`“${name}” is password-protected. Remove the password and upload it again.`);
    throw fail(`“${name}” could not be read as a PDF. It may be damaged; try exporting it again.`);
  }
}

function plainText(bytes: Buffer, name: string): string {
  if (bytes.includes(0)) throw fail(`“${name}” looks like a binary file, not plain text.`);
  try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
  catch { throw fail(`“${name}” is not readable UTF-8 text. Save it as UTF-8 and try again.`); }
}

export async function extractMaterials(value: unknown): Promise<ExtractedMaterial[]> {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw fail('Uploaded materials must be a list of files.');
  if (value.length > MATERIAL_LIMITS.files) throw fail(`Upload at most ${MATERIAL_LIMITS.files} files.`);
  let total = 0;
  const results: ExtractedMaterial[] = [];
  for (const item of value) {
    const row = item && typeof item === 'object' ? item as Record<string, unknown> : {};
    const name = safeName(row.name);
    if (typeof row.data !== 'string' || !/^[A-Za-z0-9+/]*={0,2}$/.test(row.data)) throw fail(`“${name}” was not received correctly. Please choose it again.`);
    const bytes = Buffer.from(row.data, 'base64');
    if (!bytes.length) throw fail(`“${name}” is empty.`);
    if (bytes.length > MATERIAL_LIMITS.fileBytes) throw fail(`“${name}” is larger than ${MATERIAL_LIMITS.fileBytes / 1024 / 1024} MB.`);
    total += bytes.length;
    if (total > MATERIAL_LIMITS.totalBytes) throw fail(`Uploaded files together must be under ${MATERIAL_LIMITS.totalBytes / 1024 / 1024} MB.`);
    const extension = name.toLowerCase().match(/\.[a-z]+$/)?.[0] ?? '';
    const isPdf = bytes.subarray(0, 5).toString('latin1') === '%PDF-';
    let kind: StudyMaterial['kind']; let raw: string; let pages: number | undefined;
    if (extension === '.pdf' || isPdf) {
      if (!isPdf) throw fail(`“${name}” is not a valid PDF file.`);
      ({ text: raw, pages } = await pdfText(bytes, name)); kind = 'pdf';
    } else if (extension === '.txt' || extension === '.md' || extension === '.markdown') {
      raw = plainText(bytes, name); kind = extension === '.txt' ? 'text' : 'markdown';
    } else throw fail(`“${name}” is not supported. Upload a PDF, TXT, or Markdown (.md) file.`);
    const text = normalizeText(raw);
    if (text.replace(/\s/g, '').length < MINIMUM_READABLE) {
      throw fail(kind === 'pdf'
        ? `“${name}” has no selectable text. Scanned or image-only PDFs aren’t supported yet; upload a text-based PDF or paste your notes.`
        : `“${name}” doesn’t contain enough readable text.`);
    }
    const truncated = text.length > STORED_CHARACTERS;
    const stored = truncated ? text.slice(0, STORED_CHARACTERS) : text;
    results.push({ meta: { id: randomUUID(), name, kind, characters: stored.length, pages, truncated }, text: stored });
  }
  return results;
}

/** Evenly spaced windows so long documents are represented beyond their opening pages. */
function sample(text: string, budget: number): string {
  if (text.length <= budget) return text;
  const windows = Math.max(1, Math.floor(budget / 1200));
  const size = Math.floor(budget / windows);
  const stride = (text.length - size) / Math.max(1, windows - 1);
  return Array.from({ length: windows }, (_, index) => text.slice(Math.round(index * stride), Math.round(index * stride) + size)).join('\n[…]\n');
}

/** A bounded, labeled excerpt of all materials, or '' when there are none. */
export function materialExcerpt(materials: PrivateMaterial[] | undefined, budget: number): string {
  if (!materials?.length) return '';
  const share = Math.floor(budget / materials.length);
  return materials.map((material) => `### File: ${material.name}\n${sample(material.text, share)}`).join('\n\n');
}
