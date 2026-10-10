// Builds small, valid, uncompressed PDFs for extraction tests.
// `lines` become real text-drawing operators; omit them to produce a page with
// only vector drawing (the same extraction outcome as a scanned/image-only PDF).
export function buildPdf(lines: string[] = []): Buffer {
  const escape = (value: string) => value.replace(/[\\()]/g, (character) => `\\${character}`);
  const content = lines.length
    ? `BT /F1 12 Tf 72 720 Td 14 TL ${lines.map((line) => `(${escape(line)}) Tj T*`).join(' ')} ET`
    : '0 0 1 rg 72 72 200 200 re f';
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${Buffer.byteLength(content, 'latin1')} >>\nstream\n${content}\nendstream`,
  ];
  let body = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((object, index) => { offsets.push(Buffer.byteLength(body, 'latin1')); body += `${index + 1} 0 obj\n${object}\nendobj\n`; });
  const xref = Buffer.byteLength(body, 'latin1');
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}`;
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(body, 'latin1');
}
