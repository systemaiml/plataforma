/* Lector y escritor mínimo de archivos .xlsx (usa JSZip). Sin dependencias de internet. */
(function (global) {
  'use strict';

  const NS_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

  function colToIndex(ref) {
    const m = /^([A-Z]+)/.exec(ref);
    let n = 0;
    for (const ch of m[1]) n = n * 26 + (ch.charCodeAt(0) - 64);
    return n - 1;
  }
  function indexToCol(i) {
    let s = '';
    i += 1;
    while (i > 0) { const r = (i - 1) % 26; s = String.fromCharCode(65 + r) + s; i = Math.floor((i - 1) / 26); }
    return s;
  }
  function parseXml(text) {
    const doc = new DOMParser().parseFromString(text, 'application/xml');
    if (doc.getElementsByTagName('parsererror').length) throw new Error('XML inválido en el archivo Excel');
    return doc;
  }
  function kids(node, name) {
    return Array.from(node.childNodes).filter(n => n.nodeType === 1 && n.localName === name);
  }
  function textOfSi(si) {
    let out = '';
    for (const n of Array.from(si.childNodes)) {
      if (n.nodeType !== 1) continue;
      if (n.localName === 't') out += n.textContent;
      else if (n.localName === 'r') kids(n, 't').forEach(t => { out += t.textContent; });
    }
    return out;
  }
  function resolvePath(target) {
    if (target.startsWith('/')) return target.slice(1);
    return 'xl/' + target.replace(/^\.\//, '');
  }

  /** Devuelve [{name, rows:[[valor,...],...]}] con todas las hojas. */
  async function readXlsx(arrayBuffer) {
    const zip = await JSZip.loadAsync(arrayBuffer);
    const wbFile = zip.file('xl/workbook.xml');
    if (!wbFile) throw new Error('No parece un archivo .xlsx válido');
    const wb = parseXml(await wbFile.async('string'));
    const relsFile = zip.file('xl/_rels/workbook.xml.rels');
    const rels = {};
    if (relsFile) {
      const rd = parseXml(await relsFile.async('string'));
      Array.from(rd.getElementsByTagName('Relationship')).forEach(r => {
        rels[r.getAttribute('Id')] = r.getAttribute('Target');
      });
    }
    const shared = [];
    const ssFile = zip.file('xl/sharedStrings.xml');
    if (ssFile) {
      const sd = parseXml(await ssFile.async('string'));
      Array.from(sd.getElementsByTagName('si')).forEach(si => shared.push(textOfSi(si)));
    }
    const sheets = [];
    const sheetNodes = Array.from(wb.getElementsByTagName('sheet'));
    for (const sn of sheetNodes) {
      const rid = sn.getAttributeNS(NS_REL, 'id') || sn.getAttribute('r:id');
      const path = resolvePath(rels[rid] || '');
      const f = zip.file(path);
      if (!f) continue;
      const sd = parseXml(await f.async('string'));
      const rows = [];
      Array.from(sd.getElementsByTagName('row')).forEach(rowEl => {
        const rIdx = parseInt(rowEl.getAttribute('r'), 10) - 1;
        const arr = [];
        Array.from(rowEl.getElementsByTagName('c')).forEach(c => {
          const ci = colToIndex(c.getAttribute('r'));
          const t = c.getAttribute('t');
          const vEl = kids(c, 'v')[0];
          let val = null;
          if (t === 'inlineStr') {
            const is = kids(c, 'is')[0];
            val = is ? textOfSi(is) : '';
          } else if (vEl) {
            const raw = vEl.textContent;
            if (t === 's') val = shared[parseInt(raw, 10)];
            else if (t === 'str' || t === 'e') val = raw;
            else if (t === 'b') val = raw === '1';
            else val = raw === '' ? null : Number(raw);
          }
          arr[ci] = val === undefined ? null : val;
        });
        rows[isNaN(rIdx) ? rows.length : rIdx] = arr;
      });
      for (let i = 0; i < rows.length; i++) if (!rows[i]) rows[i] = [];
      sheets.push({ name: sn.getAttribute('name'), rows });
    }
    return sheets;
  }

  function esc(s) {
    return String(s).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function dateSerial(iso) {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
    if (!m) return null;
    return Math.round((Date.UTC(+m[1], +m[2] - 1, +m[3]) - Date.UTC(1899, 11, 30)) / 86400000);
  }
  function serialToIso(n) {
    const d = new Date(Math.round(n) * 86400000 + Date.UTC(1899, 11, 30));
    return d.toISOString().slice(0, 10);
  }

  /**
   * sheets: [{name, header:[...], rows:[[...]], widths:[...], dateCols:[idx], freeze:true, filter:true, plain:true}]
   * Valores: number, string, null. En columnas de dateCols los strings ISO (AAAA-MM-DD) se guardan como fecha.
   */
  async function writeXlsx(sheets) {
    const zip = new JSZip();
    const ct = ['<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">',
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>',
      '<Default Extension="xml" ContentType="application/xml"/>',
      '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>',
      '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>'];
    sheets.forEach((s, i) => ct.push(`<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`));
    ct.push('</Types>');
    zip.file('[Content_Types].xml', ct.join(''));
    zip.file('_rels/.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>');

    const wbSheets = sheets.map((s, i) => `<sheet name="${esc(s.name.slice(0, 31))}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('');
    zip.file('xl/workbook.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="${NS_REL}"><sheets>${wbSheets}</sheets></workbook>`);
    const wbRels = sheets.map((s, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')
      + `<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>`;
    zip.file('xl/_rels/workbook.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${wbRels}</Relationships>`);

    zip.file('xl/styles.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
      + '<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font></fonts>'
      + '<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF0877B8"/><bgColor indexed="64"/></patternFill></fill></fills>'
      + '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>'
      + '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>'
      + '<cellXfs count="3"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>'
      + '<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/>'
      + '<xf numFmtId="14" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/></cellXfs></styleSheet>');

    sheets.forEach((s, si) => {
      const dateCols = new Set(s.dateCols || []);
      const out = [];
      const cellXml = (v, r, c, style) => {
        const ref = indexToCol(c) + (r + 1);
        if (v === null || v === undefined || v === '') return '';
        const st = style ? ` s="${style}"` : '';
        if (typeof v === 'number' && isFinite(v)) return `<c r="${ref}"${st}><v>${v}</v></c>`;
        return `<c r="${ref}"${st} t="inlineStr"><is><t xml:space="preserve">${esc(v)}</t></is></c>`;
      };
      let r = 0;
      if (s.header) {
        out.push(`<row r="1">${s.header.map((h, c) => cellXml(h, 0, c, 1)).join('')}</row>`);
        r = 1;
      }
      s.rows.forEach(row => {
        const cells = row.map((v, c) => {
          if (dateCols.has(c) && typeof v === 'string' && v) {
            const n = dateSerial(v);
            if (n !== null) return `<c r="${indexToCol(c)}${r + 1}" s="2"><v>${n}</v></c>`;
          }
          return cellXml(v, r, c, 0);
        }).join('');
        out.push(`<row r="${r + 1}">${cells}</row>`);
        r++;
      });
      const ncols = Math.max((s.header || []).length, ...s.rows.map(x => x.length), 1);
      const cols = (s.widths || []).length
        ? `<cols>${s.widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('')}</cols>` : '';
      const view = s.freeze
        ? '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>'
        : '<sheetViews><sheetView workbookViewId="0"/></sheetViews>';
      const filter = s.filter && s.header ? `<autoFilter ref="A1:${indexToCol(ncols - 1)}${Math.max(r, 1)}"/>` : '';
      zip.file(`xl/worksheets/sheet${si + 1}.xml`, `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${view}${cols}<sheetData>${out.join('')}</sheetData>${filter}</worksheet>`);
    });
    return zip.generateAsync({ type: 'blob', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', compression: 'DEFLATE' });
  }

  global.MiniXlsx = { readXlsx, writeXlsx, serialToIso };
})(window);
