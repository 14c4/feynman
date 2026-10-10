// The Markdown subset used by the review sheet: headings, paragraphs, block quotes, flat lists,
// bold, italic and inline code. One parser feeds both the on-page view and the PDF export,
// so the two always show the same content.

export type MarkdownBlock =
  | { kind: 'heading'; level: number; text: string }
  | { kind: 'paragraph'; lines: string[] }
  | { kind: 'quote'; paragraphs: string[][] }
  | { kind: 'list'; ordered: boolean; start: number; items: string[] };
export interface InlineRun { text: string; style: 'normal' | 'bold' | 'italic' | 'code' }

const LIST = /^\s*([-*+]|\d+[.)])\s+(.*)$/;

export function parseMarkdown(markdown: string): MarkdownBlock[] {
  const lines = markdown.replace(/\r\n?/g, '\n').split('\n'); const blocks: MarkdownBlock[] = [];
  for (let index = 0; index < lines.length;) {
    const line = lines[index]!;
    if (!line.trim()) { index++; continue; }
    const heading = line.match(/^(#{1,6})\s+(.*)$/);
    if (heading) { blocks.push({ kind: 'heading', level: heading[1]!.length, text: heading[2]! }); index++; continue; }
    if (/^\s*>/.test(line)) {
      const paragraphs: string[][] = [[]];
      for (; index < lines.length && /^\s*>/.test(lines[index]!); index++) {
        const text = lines[index]!.replace(/^\s*>\s?/, '');
        if (text.trim()) paragraphs.at(-1)!.push(text); else if (paragraphs.at(-1)!.length) paragraphs.push([]);
      }
      blocks.push({ kind: 'quote', paragraphs: paragraphs.filter((paragraph) => paragraph.length) }); continue;
    }
    const first = line.match(LIST);
    if (first) {
      const ordered = /\d/.test(first[1]!); const items: string[] = [];
      while (index < lines.length) {
        const item = lines[index]!.match(LIST);
        if (item && /\d/.test(item[1]!) === ordered) items.push(item[2]!);
        else if (items.length && /^\s{2,}\S/.test(lines[index]!)) items[items.length - 1] += `\n${lines[index]!.trim()}`;
        else break;
        index++;
      }
      blocks.push({ kind: 'list', ordered, start: ordered ? Number.parseInt(first[1]!, 10) : 1, items }); continue;
    }
    const paragraph: string[] = [];
    for (; index < lines.length && lines[index]!.trim() && !/^#{1,6}\s|^\s*>/.test(lines[index]!) && !LIST.test(lines[index]!); index++) paragraph.push(lines[index]!);
    blocks.push({ kind: 'paragraph', lines: paragraph });
  }
  return blocks;
}

export function inlineRuns(text: string): InlineRun[] {
  return text.split(/(\*\*[^*]+?\*\*|`[^`]+`|\*[^*\s][^*]*?\*)/g).filter(Boolean).map((part) => {
    if (part.length > 4 && part.startsWith('**') && part.endsWith('**')) return { text: part.slice(2, -2), style: 'bold' };
    if (part.length > 2 && part.startsWith('`') && part.endsWith('`')) return { text: part.slice(1, -1), style: 'code' };
    if (part.length > 2 && part.startsWith('*') && part.endsWith('*')) return { text: part.slice(1, -1), style: 'italic' };
    return { text: part, style: 'normal' };
  });
}
