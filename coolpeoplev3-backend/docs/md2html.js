// Minimal, dependency-free Markdown → HTML for the MASTER doc.
// Handles: #/##/### headings, **bold**, *italic*, `code`, tables, `-` lists
// (one nesting level), `---` rules, `>` blockquotes, paragraphs.
const fs = require('fs');
const [, , inPath, outPath] = process.argv;
const src = fs.readFileSync(inPath, 'utf8');

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
function inline(s) {
  // protect code spans
  const codes = [];
  s = s.replace(/`([^`]+)`/g, (_, c) => { codes.push(c); return ` ${codes.length - 1} `; });
  s = esc(s);
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/(^|[^*])\*([^*]+)\*/g, '$1<em>$2</em>');
  s = s.replace(/ (\d+) /g, (_, i) => `<code>${esc(codes[+i])}</code>`);
  return s;
}

const lines = src.split('\n');
let html = '';
let i = 0;
let para = [];
const flushPara = () => { if (para.length) { html += `<p>${inline(para.join(' '))}</p>\n`; para = []; } };

while (i < lines.length) {
  let line = lines[i];

  // table: a line with | and a following |---| separator
  if (/^\s*\|.*\|\s*$/.test(line) && i + 1 < lines.length && /^\s*\|[\s:|-]+\|\s*$/.test(lines[i + 1])) {
    flushPara();
    const header = line.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
    i += 2; // skip separator
    let rows = '';
    while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) {
      const cells = lines[i].trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
      rows += '<tr>' + cells.map((c) => `<td>${inline(c)}</td>`).join('') + '</tr>\n';
      i++;
    }
    html += '<table><thead><tr>' + header.map((h) => `<th>${inline(h)}</th>`).join('') + '</tr></thead><tbody>\n' + rows + '</tbody></table>\n';
    continue;
  }

  if (/^### /.test(line)) { flushPara(); html += `<h3>${inline(line.slice(4))}</h3>\n`; i++; continue; }
  if (/^## /.test(line)) { flushPara(); html += `<h2>${inline(line.slice(3))}</h2>\n`; i++; continue; }
  if (/^# /.test(line)) { flushPara(); html += `<h1>${inline(line.slice(2))}</h1>\n`; i++; continue; }
  if (/^---\s*$/.test(line)) { flushPara(); html += '<hr/>\n'; i++; continue; }
  if (/^>\s?/.test(line)) { flushPara(); html += `<blockquote>${inline(line.replace(/^>\s?/, ''))}</blockquote>\n`; i++; continue; }

  // lists (one nesting level via 2-space indent)
  if (/^\s*-\s+/.test(line)) {
    flushPara();
    html += '<ul>\n';
    let depth = 0;
    while (i < lines.length && /^\s*-\s+/.test(lines[i])) {
      const indent = lines[i].match(/^(\s*)-/)[1].length;
      const content = inline(lines[i].replace(/^\s*-\s+/, ''));
      if (indent >= 2 && depth === 0) { html += '<ul>\n'; depth = 1; }
      else if (indent < 2 && depth === 1) { html += '</ul>\n'; depth = 0; }
      html += `<li>${content}</li>\n`;
      i++;
    }
    if (depth === 1) html += '</ul>\n';
    html += '</ul>\n';
    continue;
  }

  if (/^\s*$/.test(line)) { flushPara(); i++; continue; }
  para.push(line.trim());
  i++;
}
flushPara();

const css = `
@page { size: Letter; margin: 14mm 16mm; }
* { box-sizing: border-box; }
body { font: 10.5px/1.5 -apple-system, "Helvetica Neue", Arial, sans-serif; color: #1a1a1a; max-width: 100%; }
h1 { font-size: 19px; color: #0b3d6b; border-bottom: 3px solid #0b3d6b; padding-bottom: 4px; margin: 22px 0 10px; page-break-after: avoid; }
h2 { font-size: 15px; color: #0b3d6b; border-bottom: 1px solid #c9d6e3; padding-bottom: 3px; margin: 18px 0 8px; page-break-after: avoid; }
h3 { font-size: 12.5px; color: #14507f; margin: 12px 0 5px; page-break-after: avoid; }
p { margin: 6px 0; }
ul { margin: 5px 0 5px 0; padding-left: 20px; }
li { margin: 2.5px 0; }
code { font-family: "SF Mono", "Menlo", monospace; font-size: 9.2px; background: #eef2f6; padding: 1px 4px; border-radius: 3px; color: #0a3055; }
strong { color: #111; }
hr { border: none; border-top: 1px solid #d8dee6; margin: 16px 0; }
blockquote { border-left: 3px solid #f0a500; background: #fdf7e7; margin: 8px 0; padding: 6px 12px; color: #5a4a1a; }
table { border-collapse: collapse; width: 100%; margin: 10px 0; font-size: 9.5px; page-break-inside: avoid; }
th { background: #0b3d6b; color: #fff; text-align: left; padding: 6px 8px; }
td { border: 1px solid #d8dee6; padding: 5px 8px; vertical-align: top; }
tr:nth-child(even) td { background: #f6f9fc; }
`;

const out = `<!doctype html><html><head><meta charset="utf-8"><style>${css}</style></head><body>\n${html}\n</body></html>`;
fs.writeFileSync(outPath, out);
console.log('wrote', outPath, out.length, 'bytes');
