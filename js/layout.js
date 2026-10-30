// Screenplay line layout shared by the snippet image and the PDF: wraps
// each element into a 60-column text block (10 cpi on a 6" line) with
// the standard indents and blank lead lines between elements.

export const up = (s) => (s || '').toUpperCase();
export const stripParens = (s) => (s || '').replace(/^\(+/, '').replace(/\)+$/, '').trim();

export function wrap(text, width) {
  const out = [];
  for (const para of text.split('\n')) {
    let line = '';
    for (const word of para.split(/\s+/).filter(Boolean)) {
      if (!line) line = word;
      else if (line.length + 1 + word.length <= width) line += ' ' + word;
      else {
        out.push(line);
        line = word;
      }
      while (line.length > width) {
        out.push(line.slice(0, width));
        line = line.slice(width);
      }
    }
    out.push(line);
  }
  return out;
}

// Column layout in a 60-column page (10 cpi on a 6" text block), using
// standard screenplay indents. Each line: { text, col, bold, underline, align }.
export const COLS = 60;
const STYLE = {
  scene: { col: 0, width: 60, lead: 1, bold: true },
  action: { col: 0, width: 60, lead: 1 },
  character: { col: 22, width: 38, lead: 1 },
  paren: { col: 16, width: 25, lead: 0 },
  dialogue: { col: 10, width: 35, lead: 0 },
  transition: { col: 0, width: 60, lead: 1, align: 'right' },
  marker: { col: 0, width: 60, lead: 1, bold: true, underline: true, align: 'center' },
};

export function layoutLines(els) {
  const lines = [];
  for (const el of els) {
    let text = (el.text || '').trim();
    if (!text) continue;
    const st = STYLE[el.type] || STYLE.action;
    if (['scene', 'character', 'transition', 'marker'].includes(el.type)) text = up(text);
    if (el.type === 'paren') text = '(' + stripParens(text) + ')';
    if (lines.length) for (let k = 0; k < st.lead; k++) lines.push({ text: '' });
    for (const t of wrap(text, st.width)) {
      lines.push({
        text: t,
        type: el.type,
        id: el.id, // lets the timeline find each element's page
        col: st.col,
        bold: st.bold,
        underline: st.underline,
        align: st.align,
      });
    }
  }
  return lines;
}
