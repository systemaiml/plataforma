(function () {
  'use strict';

  /* ---------- Definición de columnas (coinciden con la hoja «Unificado») ---------- */
  const COLS = [
    { k: 'nombre',   h: 'Nombre' },
    { k: 'rut',      h: 'RUT' },
    { k: 'edad',     h: 'Edad', type: 'num' },
    { k: 'telefono', h: 'Teléfono' },
    { k: 'fecha',    h: 'Fecha inscripción (más antigua)', type: 'date' },
    { k: 'obs',      h: 'Observación (lista oficial)' },
    { k: 'rsh',      h: 'Registro Social de Hogares (lista inscritos)' },
    { k: 'notas',    h: 'Notas (lista inscritos)' },
    { k: 'inscribe', h: 'Quién inscribe (lista oficial)' },
    { k: 'presente', h: 'Presente en' },
    { k: 'vIns',     h: 'Veces en inscritos', type: 'num' },
    { k: 'vOf',      h: 'Veces en oficial', type: 'num' },
    { k: 'fIns',     h: 'Filas en archivo inscritos' },
    { k: 'fOf',      h: 'Filas en archivo oficial' },
    { k: 'alertas',  h: 'Alertas de revisión' }
  ];
  const PRESENTE = ['En ambas', 'Solo inscritos', 'Solo oficial'];
  const STORE_KEY = 'personas-mayores.las-cabras.v1';
  const WIDTHS = [34, 14, 7, 13, 16, 22, 30, 30, 22, 14, 10, 10, 16, 16, 50];

  const $ = (s, r = document) => r.querySelector(s);
  const state = {
    rows: [], nextId: 1, sort: { k: null, dir: 1 }, page: 1, pageSize: 25,
    q: '', fPresente: '', fRsh: '', fAlertas: false,
    editingId: null, deletingId: null, viewingId: null, pendingImport: null
  };

  /* ---------- Utilidades ---------- */
  const norm = s => String(s == null ? '' : s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
  const rutClean = s => String(s || '').replace(/[^0-9kK]/g, '').toUpperCase();
  function rutDv(body) {
    let sum = 0, mul = 2;
    for (let i = body.length - 1; i >= 0; i--) { sum += +body[i] * mul; mul = mul === 7 ? 2 : mul + 1; }
    const r = 11 - (sum % 11);
    return r === 11 ? '0' : r === 10 ? 'K' : String(r);
  }
  function rutFormat(s) {
    const c = rutClean(s);
    if (c.length < 2) return String(s || '').trim();
    const body = c.slice(0, -1).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
    return body + '-' + c.slice(-1);
  }
  function rutStatus(s) {
    const c = rutClean(s);
    if (c.length < 8 || c.length > 9 || !/^\d+[0-9K]$/.test(c)) return { ok: false, format: false };
    const dv = rutDv(c.slice(0, -1));
    return { ok: dv === c.slice(-1), format: true, dv };
  }
  const isoToDisplay = iso => {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || '');
    return m ? `${m[3]}-${m[2]}-${m[1]}` : '';
  };
  const str = v => (v == null ? '' : String(v));
  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toast.t);
    toast.t = setTimeout(() => t.classList.remove('show'), 3200);
  }
  function el(tag, props, ...children) {
    const e = document.createElement(tag);
    if (props) for (const [k, v] of Object.entries(props)) {
      if (k === 'class') e.className = v; else if (k === 'text') e.textContent = v; else e.setAttribute(k, v);
    }
    children.forEach(c => c != null && e.append(c));
    return e;
  }

  /* ---------- Persistencia (navegador) ---------- */
  function save() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify({ rows: state.rows, nextId: state.nextId })); }
    catch (e) { toast('No se pudo guardar en el navegador. Descarga el Excel para no perder los cambios.'); }
  }
  function load() {
    try {
      const d = JSON.parse(localStorage.getItem(STORE_KEY) || 'null');
      if (d && Array.isArray(d.rows)) { state.rows = d.rows; state.nextId = d.nextId || (d.rows.length + 1); }
    } catch (e) { /* sin datos guardados */ }
  }

  /* ---------- Importar / exportar Excel ---------- */
  function cellToField(col, v) {
    if (v == null || v === '') return col.type === 'num' ? null : '';
    if (col.type === 'date') {
      if (typeof v === 'number') return MiniXlsx.serialToIso(v);
      const s = String(v).trim();
      const m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/.exec(s);
      if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
      return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : s;
    }
    if (col.type === 'num') { const n = Number(v); return isFinite(n) ? n : null; }
    return String(v).trim();
  }
  function sheetToRows(sheet) {
    const header = (sheet.rows[0] || []).map(norm);
    const idx = COLS.map((c, i) => { const j = header.indexOf(norm(c.h)); return j >= 0 ? j : -1; });
    const fallback = idx.every(i => i === -1);
    const out = [];
    for (let r = 1; r < sheet.rows.length; r++) {
      const row = sheet.rows[r];
      if (!row || row.every(v => v == null || v === '')) continue;
      const o = {};
      COLS.forEach((c, i) => { o[c.k] = cellToField(c, row[fallback ? i : idx[i]]); });
      if (!o.nombre && !o.rut) continue;
      o.rut = o.rut ? rutFormat(o.rut) : '';
      out.push(o);
    }
    return out;
  }
  async function handleFile(file) {
    if (!file) return;
    try {
      const sheets = await MiniXlsx.readXlsx(await file.arrayBuffer());
      const sheet = sheets.find(s => norm(s.name) === 'unificado')
        || sheets.find(s => (s.rows[0] || []).some(h => norm(h) === 'rut'));
      if (!sheet) throw new Error('No encontré una hoja con columna RUT (se espera la hoja «Unificado»).');
      const rows = sheetToRows(sheet);
      if (!rows.length) throw new Error('La hoja no tiene filas con datos.');
      state.pendingImport = rows;
      if (!state.rows.length) return confirmImport();
      $('#impText').textContent = `Se encontraron ${rows.length} registros en la hoja «${sheet.name}». Esto reemplazará los ${state.rows.length} registros que hay ahora en este navegador. ¿Continuar?`;
      $('#dlgImport').showModal();
    } catch (e) {
      toast('No se pudo leer el Excel: ' + e.message);
    }
  }
  function confirmImport() {
    const rows = state.pendingImport || [];
    state.rows = rows.map((r, i) => Object.assign({ _id: i + 1 }, r));
    state.nextId = rows.length + 1;
    state.pendingImport = null;
    state.page = 1;
    save(); refresh();
    toast(`Se cargaron ${rows.length} registros.`);
  }
  async function exportExcel() {
    const data = state.rows.map(r => COLS.map(c => {
      const v = r[c.k];
      if (c.k === 'telefono' && /^\d{1,15}$/.test(str(v))) return Number(v);
      return v === '' ? null : v;
    }));
    const count = v => state.rows.filter(r => r.presente === v).length;
    const resumen = [
      ['Personas únicas (por RUT)', state.rows.length],
      ['En ambas listas', count('En ambas')],
      ['Solo en lista de inscritos', count('Solo inscritos')],
      ['Solo en lista oficial', count('Solo oficial')],
      ['Personas con alertas de revisión', state.rows.filter(r => str(r.alertas).trim()).length],
      ['Exportado el', new Date().toLocaleString('es-CL')]
    ];
    const blob = await MiniXlsx.writeXlsx([
      { name: 'Resumen', rows: resumen, widths: [38, 22] },
      { name: 'Unificado', header: COLS.map(c => c.h), rows: data, widths: WIDTHS, dateCols: [4], freeze: true, filter: true }
    ]);
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `Tarjeta_Personas_Mayores_${new Date().toISOString().slice(0, 10)}.xlsx`;
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    toast('Excel descargado.');
  }

  /* ---------- Filtros, orden y paginación ---------- */
  function filtered() {
    const q = norm(state.q), qr = rutClean(state.q);
    let rows = state.rows.filter(r => {
      if (state.fPresente && r.presente !== state.fPresente) return false;
      if (state.fRsh && norm(r.rsh) !== state.fRsh) return false;
      if (state.fAlertas && !str(r.alertas).trim()) return false;
      if (!q) return true;
      return norm(r.nombre).includes(q) || (qr.length >= 3 && rutClean(r.rut).includes(qr))
        || norm(r.telefono).includes(q) || norm(r.notas).includes(q);
    });
    const { k, dir } = state.sort;
    if (k) {
      const col = COLS.find(c => c.k === k);
      rows = rows.slice().sort((a, b) => {
        let x = a[k], y = b[k];
        if (col.type === 'num') { x = x == null ? -Infinity : x; y = y == null ? -Infinity : y; return (x - y) * dir; }
        return str(x).localeCompare(str(y), 'es', { sensitivity: 'base', numeric: true }) * dir;
      });
    }
    return rows;
  }

  const VISIBLE = [
    { k: 'nombre', h: 'Nombre' }, { k: 'rut', h: 'RUT' }, { k: 'edad', h: 'Edad' },
    { k: 'telefono', h: 'Teléfono' }, { k: 'fecha', h: 'Inscripción' },
    { k: 'obs', h: 'Observación' }, { k: 'rsh', h: 'Reg. Social Hogares' },
    { k: 'presente', h: 'Presente en' }, { k: 'alertas', h: 'Alertas' }
  ];

  function renderHead() {
    const tr = el('tr');
    VISIBLE.forEach(c => {
      const arrow = state.sort.k === c.k ? (state.sort.dir === 1 ? '▲' : '▼') : '';
      const btn = el('button', { type: 'button', 'data-sort': c.k, text: c.h }, arrow ? el('span', { text: arrow, 'aria-hidden': 'true' }) : null);
      const th = el('th', { scope: 'col' }, btn);
      if (state.sort.k === c.k) th.setAttribute('aria-sort', state.sort.dir === 1 ? 'ascending' : 'descending');
      tr.append(th);
    });
    tr.append(el('th', { scope: 'col', class: 'sr-th', text: 'Acciones', style: 'text-align:right' }));
    const thead = $('#tbl thead'); thead.replaceChildren(tr);
  }

  function renderBody() {
    const all = filtered();
    const pages = Math.max(1, Math.ceil(all.length / state.pageSize));
    state.page = Math.min(state.page, pages);
    const start = (state.page - 1) * state.pageSize;
    const slice = all.slice(start, start + state.pageSize);
    const tbody = $('#tbl tbody');
    tbody.replaceChildren();
    if (!slice.length) {
      tbody.append(el('tr', null, el('td', { colspan: VISIBLE.length + 1, class: 'vacio', text: 'No hay registros que coincidan con la búsqueda.' })));
    }
    slice.forEach(r => {
      const pill = el('span', { class: 'pill ' + (r.presente === 'En ambas' ? 'ambas' : r.presente === 'Solo oficial' ? 'of' : 'ins'), text: r.presente || '—' });
      const al = str(r.alertas).trim();
      const alCell = al ? el('span', { class: 'alerta', title: al, text: 'Revisar' }) : document.createTextNode('');
      const acc = el('td', { class: 'acc' },
        el('button', { class: 'btn small', 'data-act': 'view', 'data-id': r._id, 'aria-label': 'Ver ' + str(r.nombre), text: 'Ver' }),
        el('button', { class: 'btn small', 'data-act': 'edit', 'data-id': r._id, 'aria-label': 'Editar ' + str(r.nombre), text: 'Editar' }),
        el('button', { class: 'btn small danger', 'data-act': 'del', 'data-id': r._id, 'aria-label': 'Eliminar ' + str(r.nombre), text: 'Eliminar' }));
      tbody.append(el('tr', null,
        el('td', { class: 'nombre', text: str(r.nombre) }),
        el('td', { class: 'rut', text: str(r.rut) }),
        el('td', { text: r.edad == null ? '' : r.edad }),
        el('td', { class: 'nw', text: str(r.telefono) }),
        el('td', { class: 'nw', text: isoToDisplay(r.fecha) }),
        el('td', { text: str(r.obs) }),
        el('td', { text: str(r.rsh) }),
        el('td', null, pill),
        el('td', null, alCell),
        acc));
    });
    $('#count').textContent = all.length === state.rows.length
      ? `${all.length} registros`
      : `${all.length} de ${state.rows.length} registros`;
    $('#pageInfo').textContent = `Página ${state.page} de ${pages}`;
    $('#prev').disabled = state.page <= 1;
    $('#next').disabled = state.page >= pages;
  }

  function renderStats() {
    const c = v => state.rows.filter(r => r.presente === v).length;
    const items = [
      ['Personas únicas', state.rows.length, () => setFilters({})],
      ['En ambas listas', c('En ambas'), () => setFilters({ presente: 'En ambas' })],
      ['Solo inscritos', c('Solo inscritos'), () => setFilters({ presente: 'Solo inscritos' })],
      ['Solo oficial', c('Solo oficial'), () => setFilters({ presente: 'Solo oficial' })],
      ['Con alertas de revisión', state.rows.filter(r => str(r.alertas).trim()).length, () => setFilters({ alertas: true })]
    ];
    $('#stats').replaceChildren(...items.map(([l, n, fn]) => {
      const b = el('button', { type: 'button', class: 'stat' }, el('span', { class: 'n', text: n.toLocaleString('es-CL') }), el('span', { class: 'l', text: l }));
      b.addEventListener('click', fn);
      return b;
    }));
  }
  function setFilters({ presente = '', alertas = false }) {
    state.fPresente = presente; state.fAlertas = alertas; state.fRsh = ''; state.q = ''; state.page = 1;
    $('#fPresente').value = presente; $('#fAlertas').checked = alertas; $('#fRsh').value = ''; $('#q').value = '';
    renderBody();
  }

  function renderFilterOptions() {
    const sel = $('#fPresente');
    sel.replaceChildren(el('option', { value: '', text: 'Todos' }), ...PRESENTE.map(p => el('option', { value: p, text: p })));
    sel.value = state.fPresente;
    const map = new Map();
    state.rows.forEach(r => { const n = norm(r.rsh); if (n && !map.has(n)) map.set(n, str(r.rsh).trim()); });
    const rsel = $('#fRsh');
    rsel.replaceChildren(el('option', { value: '', text: 'Todos' }), ...[...map].sort((a, b) => a[1].localeCompare(b[1], 'es')).map(([n, label]) => el('option', { value: n, text: label })));
    rsel.value = map.has(state.fRsh) ? state.fRsh : '';
    $('#rshList').replaceChildren(...[...map.values()].map(v => el('option', { value: v })));
  }

  function refresh() {
    const has = state.rows.length > 0 || state.started;
    $('#emptyState').hidden = has;
    $('#app').hidden = !has;
    if (!has) return;
    renderStats(); renderFilterOptions(); renderHead(); renderBody();
  }

  /* ---------- Formulario ---------- */
  const F = id => $('#f_' + id);
  const FIELDS = ['nombre', 'rut', 'edad', 'telefono', 'fecha', 'presente', 'obs', 'rsh', 'inscribe', 'notas', 'alertas'];

  function openForm(id) {
    state.editingId = id;
    const r = id ? state.rows.find(x => x._id === id) : null;
    $('#formTitle').textContent = r ? 'Modificar usuario' : 'Nuevo usuario';
    FIELDS.forEach(k => { F(k).value = r ? (r[k] == null ? '' : r[k]) : (k === 'presente' ? 'Solo inscritos' : ''); F(k).removeAttribute('aria-invalid'); });
    if (!r) F('fecha').value = new Date().toISOString().slice(0, 10);
    setMsg('');
    $('#dlgForm').showModal();
    F('nombre').focus();
  }
  function setMsg(text, warn) {
    const m = $('#formMsg'); m.textContent = text; m.classList.toggle('warn', !!warn);
  }
  function submitForm(ev) {
    ev.preventDefault();
    FIELDS.forEach(k => F(k).removeAttribute('aria-invalid'));
    const v = {}; FIELDS.forEach(k => { v[k] = F(k).value.trim(); });
    const fail = (k, msg) => { F(k).setAttribute('aria-invalid', 'true'); F(k).focus(); setMsg(msg); };
    if (!v.nombre) return fail('nombre', 'El nombre es obligatorio.');
    if (!v.rut) return fail('rut', 'El RUT es obligatorio.');
    const st = rutStatus(v.rut);
    if (!st.format) return fail('rut', 'El RUT no tiene un formato válido (ejemplo: 12.345.678-9).');
    const rutKey = rutClean(v.rut);
    const dup = state.rows.find(r => rutClean(r.rut) === rutKey && r._id !== state.editingId);
    if (dup) return fail('rut', `Ya existe una persona con ese RUT: ${dup.nombre}.`);
    let edad = null;
    if (v.edad !== '') {
      edad = Number(v.edad);
      if (!Number.isInteger(edad) || edad < 0 || edad > 120) return fail('edad', 'La edad debe ser un número entero entre 0 y 120.');
    }
    v.rut = rutFormat(v.rut);
    let alertas = v.alertas;
    if (!st.ok) {
      const note = `Dígito verificador no coincide (debería ser ${st.dv})`;
      if (!alertas.includes('Dígito verificador')) alertas = alertas ? alertas + '; ' + note : note;
    }
    const rec = {
      nombre: v.nombre, rut: v.rut, edad, telefono: v.telefono, fecha: v.fecha, presente: v.presente,
      obs: v.obs, rsh: v.rsh, inscribe: v.inscribe, notas: v.notas, alertas
    };
    if (state.editingId) {
      Object.assign(state.rows.find(x => x._id === state.editingId), rec);
      toast('Usuario modificado.');
    } else {
      Object.assign(rec, { vIns: 0, vOf: 0, fIns: '', fOf: '' });
      rec._id = state.nextId++;
      state.rows.unshift(rec);
      toast('Usuario ingresado.');
    }
    if (!st.ok) toast('Guardado. El dígito verificador del RUT no coincide: se marcó para revisión.');
    save(); $('#dlgForm').close(); refresh();
  }

  /* ---------- Ver / eliminar ---------- */
  function openView(id) {
    const r = state.rows.find(x => x._id === id); if (!r) return;
    state.viewingId = id;
    $('#viewTitle').textContent = r.nombre || '(sin nombre)';
    const body = $('#viewBody'); body.replaceChildren();
    COLS.forEach(c => {
      let val = r[c.k];
      if (c.type === 'date') val = isoToDisplay(val);
      body.append(el('dt', { text: c.h }), el('dd', { text: val == null || val === '' ? '—' : String(val) }));
    });
    $('#dlgView').showModal();
  }
  function openDelete(id) {
    const r = state.rows.find(x => x._id === id); if (!r) return;
    state.deletingId = id;
    $('#delText').textContent = `¿Eliminar a ${r.nombre} (RUT ${r.rut})? Esta acción no se puede deshacer, salvo que vuelvas a cargar un Excel anterior.`;
    $('#dlgDelete').showModal();
  }

  /* ---------- Eventos ---------- */
  document.addEventListener('click', ev => {
    const t = ev.target.closest('[data-action],[data-act],[data-sort],[data-close]');
    if (!t) return;
    if (t.dataset.close !== undefined) return t.closest('dialog').close();
    if (t.dataset.sort) {
      const k = t.dataset.sort;
      state.sort = state.sort.k === k ? { k, dir: -state.sort.dir } : { k, dir: 1 };
      return refresh();
    }
    if (t.dataset.act) {
      const id = Number(t.dataset.id);
      return t.dataset.act === 'view' ? openView(id) : t.dataset.act === 'edit' ? openForm(id) : openDelete(id);
    }
    switch (t.dataset.action) {
      case 'new': return openForm(null);
      case 'import': return $('#file').click();
      case 'export': return exportExcel();
      case 'start-empty': state.started = true; return refresh();
    }
  });
  $('#file').addEventListener('change', e => { const f = e.target.files[0]; e.target.value = ''; handleFile(f); });
  $('#form').addEventListener('submit', submitForm);
  $('#form').addEventListener('input', e => { e.target.removeAttribute('aria-invalid'); if (!$('#formMsg').classList.contains('warn')) setMsg(''); });
  F('rut').addEventListener('blur', () => {
    const v = F('rut').value.trim(); if (!v) return setMsg('');
    const st = rutStatus(v);
    if (st.format) F('rut').value = rutFormat(v);
    setMsg(st.format && !st.ok ? `Aviso: el dígito verificador no coincide (debería ser ${st.dv}). Podrás guardarlo, pero quedará marcado para revisión.` : '', true);
  });
  $('#viewEdit').addEventListener('click', () => { $('#dlgView').close(); openForm(state.viewingId); });
  $('#delConfirm').addEventListener('click', () => {
    state.rows = state.rows.filter(r => r._id !== state.deletingId);
    save(); $('#dlgDelete').close(); refresh(); toast('Usuario eliminado.');
  });
  $('#impConfirm').addEventListener('click', () => { $('#dlgImport').close(); confirmImport(); });

  let tmr;
  $('#q').addEventListener('input', e => { clearTimeout(tmr); tmr = setTimeout(() => { state.q = e.target.value; state.page = 1; renderBody(); }, 150); });
  $('#fPresente').addEventListener('change', e => { state.fPresente = e.target.value; state.page = 1; renderBody(); });
  $('#fRsh').addEventListener('change', e => { state.fRsh = e.target.value; state.page = 1; renderBody(); });
  $('#fAlertas').addEventListener('change', e => { state.fAlertas = e.target.checked; state.page = 1; renderBody(); });
  $('#pageSize').addEventListener('change', e => { state.pageSize = Number(e.target.value); state.page = 1; renderBody(); });
  $('#prev').addEventListener('click', () => { state.page--; renderBody(); });
  $('#next').addEventListener('click', () => { state.page++; renderBody(); });

  load();
  refresh();
})();
