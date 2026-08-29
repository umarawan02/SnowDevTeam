/**
 * Minimal Markdown -> HTML renderer, tuned for the agent pipeline's artifacts.
 *
 * Handles: ATX headings, GFM pipe tables, ordered/unordered lists (one level of
 * nesting + lazy continuation), fenced code, blockquotes, `---`, links, inline
 * `code` / **bold** / *em*, and the Developer's `=== FILE: path ===` blocks
 * (rendered as titled code cards). It also chips the QA severity words
 * BLOCKER / CONCERN / PASS.
 *
 * Every text node is HTML-escaped before inline formatting and code is fully
 * escaped, so the output is safe to inject with dangerouslySetInnerHTML for a
 * trusted single-operator tool. Ported from the standalone review page and
 * exercised against all five real artifacts.
 */

const SENT = ""; // private-use sentinel for protecting inline code spans

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function inline(src: string): string {
  const codes: string[] = [];
  let s = src.replace(/`([^`]+)`/g, (_m, c: string) => {
    codes.push(c);
    return SENT + (codes.length - 1) + SENT;
  });
  s = esc(s);
  s = s.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  s = s.replace(/(^|[^*\w])\*([^\s*][^*]*?)\*(?!\*)/g, "$1<em>$2</em>");
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_m, t: string, u: string) => {
    return `<a href="${esc(u)}" target="_blank" rel="noopener">${t}</a>`;
  });
  s = s.replace(/\b(BLOCKER|NEEDS_REWORK)\b/g, '<span class="sev blocker">$1</span>');
  s = s.replace(/\bCONCERN\b/g, '<span class="sev concern">CONCERN</span>');
  s = s.replace(/(^|[\s(|>])(PASS)\b/g, '$1<span class="sev pass">$2</span>');
  s = s.replace(new RegExp(SENT + "(\\d+)" + SENT, "g"), (_m, i: string) => {
    return `<code>${esc(codes[+i])}</code>`;
  });
  return s;
}

function slug(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^\w]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

const isListLine = (l: string) => /^(\s*)([-*+]|\d+[.)])\s+/.test(l);
const isTableHead = (a: string, b: string | undefined) =>
  a.indexOf("|") !== -1 && /^\s*\|?[\s:|-]*-[\s:|-]*\|?\s*$/.test(b || "");
const isHr = (l: string) => /^\s*([-*_])\1{2,}\s*$/.test(l);
const isHeading = (l: string) => /^#{1,6}\s/.test(l);

export function renderMarkdown(input: string): string {
  const lines = (input || "").replace(/\r\n/g, "\n").split("\n");
  const out: string[] = [];
  let i = 0;

  function parseList(baseIndent: number): string {
    const ordered = /^\s*\d+[.)]\s/.test(lines[i]);
    const tag = ordered ? "ol" : "ul";
    let html = `<${tag}>`;
    while (i < lines.length) {
      const m = lines[i].match(/^(\s*)([-*+]|\d+[.)])\s+(.*)$/);
      if (!m || m[1].length < baseIndent) break;
      if (m[1].length >= baseIndent + 2) break;
      i++;
      const text = m[3];
      let nested = "";
      const cont: string[] = [];
      while (i < lines.length) {
        const l = lines[i];
        if (l.trim() === "") {
          if (
            i + 1 < lines.length &&
            isListLine(lines[i + 1]) &&
            (lines[i + 1].match(/^(\s*)/) as RegExpMatchArray)[1].length <= baseIndent
          ) {
            break;
          }
          cont.push("");
          i++;
          continue;
        }
        const lm = l.match(/^(\s*)([-*+]|\d+[.)])\s+/);
        const lead = (l.match(/^(\s*)/) as RegExpMatchArray)[1].length;
        if (lm && lm[1].length >= baseIndent + 2) {
          nested += parseList(lm[1].length);
          continue;
        }
        if (lm && lm[1].length <= baseIndent) break;
        if (!lm && lead >= baseIndent + 2) {
          cont.push(l.trim());
          i++;
          continue;
        }
        break;
      }
      let body = inline(text);
      const extra = cont.join("\n").trim();
      if (extra) body += renderMarkdown(extra);
      body += nested;
      html += `<li>${body}</li>`;
    }
    return html + `</${tag}>`;
  }

  while (i < lines.length) {
    const line = lines[i];
    if (line.trim() === "") {
      i++;
      continue;
    }

    const fm = line.match(/^===\s*FILE:\s*(.+?)\s*===\s*$/);
    if (fm) {
      const fpath = fm[1];
      i++;
      if (/^```/.test(lines[i] || "")) i++;
      const fbuf: string[] = [];
      while (
        i < lines.length &&
        !/^```\s*$/.test(lines[i]) &&
        !/^===\s*END FILE/.test(lines[i])
      ) {
        fbuf.push(lines[i]);
        i++;
      }
      if (/^```\s*$/.test(lines[i] || "")) i++;
      if (/^===\s*END FILE/.test(lines[i] || "")) i++;
      out.push(
        `<div class="filecard"><header><span class="path">${esc(fpath)}</span>` +
          `<span class="lines">${fbuf.length} lines</span></header>` +
          `<pre><code>${esc(fbuf.join("\n"))}</code></pre></div>`,
      );
      continue;
    }

    if (/^```/.test(line)) {
      i++;
      const cbuf: string[] = [];
      while (i < lines.length && !/^```\s*$/.test(lines[i])) {
        cbuf.push(lines[i]);
        i++;
      }
      if (i < lines.length) i++;
      out.push(`<pre><code>${esc(cbuf.join("\n"))}</code></pre>`);
      continue;
    }

    const hm = line.match(/^(#{1,6})\s+(.*)$/);
    if (hm) {
      const lvl = hm[1].length;
      const id = lvl === 2 ? ` id="${slug(hm[2])}"` : "";
      out.push(`<h${lvl}${id}>${inline(hm[2].replace(/\s+#+\s*$/, ""))}</h${lvl}>`);
      i++;
      continue;
    }

    if (isHr(line)) {
      out.push("<hr>");
      i++;
      continue;
    }

    if (/^\s*>/.test(line)) {
      const qbuf: string[] = [];
      while (i < lines.length && /^\s*>/.test(lines[i])) {
        qbuf.push(lines[i].replace(/^\s*>\s?/, ""));
        i++;
      }
      out.push(`<blockquote>${renderMarkdown(qbuf.join("\n"))}</blockquote>`);
      continue;
    }

    if (isTableHead(line, lines[i + 1])) {
      const splitRow = (r: string) =>
        r
          .replace(/^\s*\|/, "")
          .replace(/\|\s*$/, "")
          .split("|")
          .map((c) => c.trim());
      const heads = splitRow(line);
      const aligns = splitRow(lines[i + 1]).map((c) => {
        if (/^:-+:$/.test(c)) return "center";
        if (/-+:$/.test(c)) return "right";
        return "left";
      });
      i += 2;
      const rows: string[][] = [];
      while (
        i < lines.length &&
        lines[i].indexOf("|") !== -1 &&
        lines[i].trim() !== ""
      ) {
        rows.push(splitRow(lines[i]));
        i++;
      }
      let t = '<div class="table-wrap"><table><thead><tr>';
      heads.forEach((h, idx) => {
        t += `<th style="text-align:${aligns[idx] || "left"}">${inline(h)}</th>`;
      });
      t += "</tr></thead><tbody>";
      rows.forEach((r) => {
        t += "<tr>";
        heads.forEach((_h, idx) => {
          t += `<td style="text-align:${aligns[idx] || "left"}">${inline(r[idx] || "")}</td>`;
        });
        t += "</tr>";
      });
      out.push(t + "</tbody></table></div>");
      continue;
    }

    if (isListLine(line)) {
      out.push(parseList((line.match(/^(\s*)/) as RegExpMatchArray)[1].length));
      continue;
    }

    const pbuf: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() !== "" &&
      !isHeading(lines[i]) &&
      !/^```/.test(lines[i]) &&
      !/^\s*>/.test(lines[i]) &&
      !/^===\s*FILE:/.test(lines[i]) &&
      !isListLine(lines[i]) &&
      !isHr(lines[i]) &&
      !isTableHead(lines[i], lines[i + 1])
    ) {
      pbuf.push(lines[i]);
      i++;
    }
    if (pbuf.length) out.push(`<p>${inline(pbuf.join(" "))}</p>`);
  }
  return out.join("\n");
}
