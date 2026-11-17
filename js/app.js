(function () {
  'use strict';

  const { HOJAS, norm, rutClean, rutFormat, celda, leerLibro } = window.Hojas;
  const HOJA = Object.fromEntries(HOJAS.map(h => [h.id, h]));
  const CFG = window.APP_CONFIG || {};
  // Si el funcionario llega desde un correo de invitación o recuperación, debe crear su contraseña
  let needPassword = /[#&?]type=(invite|recovery)/.test(location.hash);
  const linkError = (/[#&?]error_description=([^&]+)/.exec(location.hash) || [])[1];
  const db = window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY);

  const $ = (s, r = document) => r.querySelector(s);
  const vistaInicial = () => ({ q: '', filtro: '', quick: '', sort: { k: null, dir: 1 }, page: 1, pageSize: 25 });
  const state = {
    userId: null, isAdmin: false, loaded: false, started: false, lastLoad: 0,
    tab: 'ficha', data: {}, vista: {}, ruts: {},
    fichaQ: '', fichaKey: null,
    editing: null, deleting: null, viewing: null, pendingImport: null, confirmWarn: ''
  };
  HOJAS.forEach(h => { state.data[h.id] = []; state.vista[h.id] = vistaInicial(); });

  /* ---------- Utilidades ---------- */
  const str = v => (v == null ? '' : String(v));
  function rutDv(body) {
    let sum = 0, mul = 2;
    for (let i = body.length - 1; i >= 0; i--) { sum += +body[i] * mul; mul = mul === 7 ? 2 : mul + 1; }
    const r = 11 - (sum % 11);
    return r === 11 ? '0' : r === 10 ? 'K' : String(r);
  }
  function rutStatus(s) {
    const c = rutClean(s);
    if (c.length < 7 || c.length > 9 || !/^\d+[0-9K]$/.test(c)) return { ok: false, format: false };
    const dv = rutDv(c.slice(0, -1));
    return { ok: dv === c.slice(-1), format: true, dv };
  }
  const isIso = v => /^\d{4}-\d{2}-\d{2}$/.test(str(v));
  const fechaTexto = v => (isIso(v) ? `${v.slice(8, 10)}-${v.slice(5, 7)}-${v.slice(0, 4)}` : str(v));
  const mostrar = (campo, v) => (campo.type === 'datetext' ? fechaTexto(v) : v == null ? '' : String(v));
  const hoyIso = () => { const d = new Date(); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10); };
  const personaKey = r => { const c = rutClean(r.rut); return c.length >= 7 ? 'r:' + c : (r.nombre ? 'n:' + norm(r.nombre) : null); };
  const fmt = n => n.toLocaleString('es-CL');
  const pareceRut = q => /^[\d.\-\s]+[kK]?$/.test(String(q).trim()) && rutClean(q).length >= 3;
  function toast(msg, ms) {
    const t = $('#toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toast.t);
    toast.t = setTimeout(() => t.classList.remove('show'), ms || 3400);
  }
  function el(tag, props, ...children) {
    const e = document.createElement(tag);
    if (props) for (const [k, v] of Object.entries(props)) {
      if (v == null || v === false) continue;
      if (k === 'class') e.className = v; else if (k === 'text') e.textContent = v; else e.setAttribute(k, v === true ? '' : v);
    }
    children.forEach(c => c != null && c !== false && e.append(c));
    return e;
  }

  /* ---------- Indicadores rápidos por hoja ---------- */
  const esEntregada = v => isIso(v) || norm(v).includes('entreg');
  const esCumple = v => norm(v).startsWith('cumple');
  const sinTelefono = v => !str(v).trim() || norm(v).startsWith('sin');
  const enHoja = (id, r) => state.ruts[id] && state.ruts[id].has(rutClean(r.rut));
  const RAPIDOS = {
    inscritos: [
      { id: 'cumple', l: 'Cumple', f: r => esCumple(r.observacion) },
      { id: 'nocumple', l: 'No cumple', f: r => norm(r.observacion).startsWith('no cumple') },
      { id: 'otraobs', l: 'Otra observación', f: r => !!str(r.observacion).trim() && !esCumple(r.observacion) && !norm(r.observacion).startsWith('no cumple') },
      { id: 'nobenef', l: 'No están en Beneficiarios', f: r => !enHoja('beneficiarios', r) },
      { id: 'sintel', l: 'Sin teléfono', f: r => sinTelefono(r.telefono) }
    ],
    beneficiarios: [
      { id: 'entregada', l: 'Tarjeta entregada', f: r => norm(r.observacion2).includes('entreg') },
      { id: 'sinimpresa', l: 'Sin tarjeta impresa', f: r => !enHoja('tarjetas', r) && !enHoja('reimpresiones', r) },
      { id: 'sintel', l: 'Sin teléfono', f: r => sinTelefono(r.telefono) }
    ],
    tarjetas: [
      { id: 'entregada', l: 'Entregadas', f: r => esEntregada(r.entrega) },
      { id: 'pendiente', l: 'Sin entrega registrada', f: r => !str(r.entrega).trim() && !!(r.nombre || r.rut) },
      { id: 'libre', l: 'Sin persona asignada', f: r => !r.nombre && !r.rut },
      { id: 'conobs', l: 'Con observación', f: r => !!str(r.observacion).trim() }
    ],
    reimpresiones: [
      { id: 'retirada', l: 'Retiradas', f: r => !!str(r.fecha_retiro).trim() },
      { id: 'porretirar', l: 'Por retirar', f: r => !str(r.fecha_retiro).trim() }
    ]
  };

  /* ---------- Persistencia (Supabase) ---------- */
  function toDb(hoja, rec) {
    const o = {};
    hoja.campos.forEach(c => {
      if (!(c.k in rec)) return;
      let v = rec[c.k];
      if (c.type === 'int') v = v === '' || v == null || !isFinite(Number(v)) ? null : Math.round(Number(v));
      else v = v == null ? '' : String(v);
      o[c.k] = v;
    });
    if ('orden' in rec) o.orden = rec.orden;
    return o;
  }
  function fromDb(hoja, d) {
    const o = { _id: d.id, orden: d.orden };
    hoja.campos.forEach(c => { o[c.k] = d[c.k] == null ? (c.type === 'int' ? null : '') : d[c.k]; });
    return o;
  }
  async function loadTabla(hoja) {
    const out = [], step = 1000;
    for (let from = 0; ; from += step) {
      const { data, error } = await db.from(hoja.tabla).select('*')
        .order('orden', { ascending: true }).order('id', { ascending: true })
        .range(from, from + step - 1);
      if (error) throw error;
      out.push(...data);
      if (data.length < step) break;
    }
    return out.map(d => fromDb(hoja, d));
  }
  async function loadAll() {
    const res = await Promise.all(HOJAS.map(loadTabla));
    HOJAS.forEach((h, i) => { state.data[h.id] = res[i]; });
    indexar();
    state.loaded = true;
    state.lastLoad = Date.now();
  }
  function indexar() {
    HOJAS.forEach(h => { state.ruts[h.id] = new Set(state.data[h.id].map(r => rutClean(r.rut)).filter(Boolean)); });
  }
  const totalRegistros = () => HOJAS.reduce((n, h) => n + state.data[h.id].length, 0);

  /* ---------- Importar / exportar Excel ---------- */
  async function handleFile(file) {
    if (!file) return;
    try {
      const libro = await MiniXlsx.readXlsx(await file.arrayBuffer());
      const { datos, nombres } = leerLibro(libro);
      const ids = Object.keys(datos);
      if (!ids.length) throw new Error('No encontré las hojas «Inscritos», «Beneficiarios Finales», «Tarjetas Impresas» ni «Tarjeta re impresas».');
      state.pendingImport = datos;
      $('#impText').textContent = `Archivo «${file.name}». Cada hoja encontrada reemplaza por completo a la que hay en la base de datos:`;
      $('#impList').replaceChildren(...HOJAS.map(h => datos[h.id]
        ? el('li', null, el('strong', { text: h.titulo }), `: ${fmt(datos[h.id].length)} filas en la hoja «${nombres[h.id].trim()}» (hoy hay ${fmt(state.data[h.id].length)})`)
        : el('li', null, el('strong', { text: h.titulo }), ': no está en el archivo, no se modifica')));
      $('#dlgImport').showModal();
    } catch (e) {
      toast('No se pudo leer el Excel: ' + (e.message || e), 6000);
    }
  }
  async function confirmImport() {
    const datos = state.pendingImport;
    state.pendingImport = null;
    if (!datos) return;
    try {
      if (totalRegistros()) await exportExcel('Respaldo_antes_de_cargar');
      toast('Subiendo el Excel a la base de datos…', 20000);
      const { data, error } = await db.rpc('reemplazar_hojas', { datos });
      if (error) throw error;
      await loadAll();
      HOJAS.forEach(h => { state.vista[h.id] = vistaInicial(); });
      refresh();
      const pasados = data && data.pasados_a_beneficiarios ? ` · ${fmt(data.pasados_a_beneficiarios)} inscritos que cumplen pasaron a Beneficiarios` : '';
      toast('Listo: ' + HOJAS.filter(h => data && h.id in data).map(h => `${h.titulo} ${fmt(data[h.id])}`).join(' · ') + pasados, 7000);
    } catch (e) {
      toast('No se pudo subir el Excel: ' + (e.message || e), 7000);
    }
  }
  function valorExcel(c, v) {
    if (v == null || v === '') return null;
    if (c.type === 'int') return Number(v);
    if ((c.type === 'phone' || c.type === 'code') && /^\d{1,15}$/.test(str(v))) return Number(v);
    return v;
  }
  async function exportExcel(prefijo) {
    const resumen = [['Hoja', 'Registros']].concat(HOJAS.map(h => [h.excel, state.data[h.id].length]))
      .concat([[], ['Exportado el', new Date().toLocaleString('es-CL')]]);
    const hojas = HOJAS.map(h => ({
      name: h.excel,
      header: h.campos.map(c => c.h),
      rows: state.data[h.id].map(r => h.campos.map(c => valorExcel(c, r[c.k]))),
      widths: h.anchos,
      dateCols: h.campos.map((c, i) => (c.type === 'datetext' ? i : -1)).filter(i => i >= 0),
      freeze: true, filter: true
    }));
    const blob = await MiniXlsx.writeXlsx([...hojas, { name: 'Resumen', rows: resumen, widths: [26, 16] }]);
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${prefijo || 'Tarjeta_Personas_Mayores_Oficial'}_${hoyIso()}.xlsx`;
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    if (!prefijo) toast('Excel descargado.');
  }

  /* ---------- Pestañas ---------- */
  function renderTabs() {
    const tabs = [{ id: 'ficha', l: 'Buscar persona' }].concat(HOJAS.map(h => ({ id: h.id, l: h.titulo, n: state.data[h.id].length })));
    $('#tabs').replaceChildren(...tabs.map(t => el('button', {
      type: 'button', role: 'tab', class: 'tab', 'data-tab': t.id, id: 'tab-' + t.id,
      'aria-selected': state.tab === t.id ? 'true' : 'false', tabindex: state.tab === t.id ? '0' : '-1'
    }, t.l, t.n != null ? el('span', { class: 'tn', text: fmt(t.n) }) : null)));
  }
  function setTab(id) {
    state.tab = id;
    refresh();
    if (id === 'ficha') $('#fq').focus();
  }

  /* ---------- Vista de hoja: filtros, orden y paginación ---------- */
  const hojaActual = () => HOJA[state.tab];
  function filtrados(hoja) {
    const v = state.vista[hoja.id];
    const q = norm(v.q), qr = rutClean(v.q);
    const rapido = v.quick && RAPIDOS[hoja.id].find(x => x.id === v.quick);
    let rows = state.data[hoja.id].filter(r => {
      if (rapido && !rapido.f(r)) return false;
      if (hoja.filtro && v.filtro && norm(r[hoja.filtro.k]) !== v.filtro) return false;
      if (!q) return true;
      if (pareceRut(v.q) && rutClean(r.rut).includes(qr)) return true;
      return hoja.campos.some(c => c.k !== 'rut' && norm(mostrar(c, r[c.k])).includes(q));
    });
    const { k, dir } = v.sort;
    // Sin orden elegido: lo último agregado primero (el Excel se sigue descargando en su orden original)
    if (!k) rows = rows.slice().sort((a, b) => (b.orden || 0) - (a.orden || 0) || b._id - a._id);
    if (k) {
      const c = hoja.campos.find(x => x.k === k);
      rows = rows.slice().sort((a, b) => {
        let x = a[k], y = b[k];
        if (c.type === 'int') { x = x == null ? -Infinity : x; y = y == null ? -Infinity : y; return (x - y) * dir; }
        if (str(x) === '' && str(y) !== '') return 1;
        if (str(y) === '' && str(x) !== '') return -1;
        return str(x).localeCompare(str(y), 'es', { sensitivity: 'base', numeric: true }) * dir;
      });
    }
    return rows;
  }

  function renderStats(hoja) {
    const v = state.vista[hoja.id], rows = state.data[hoja.id];
    const items = [{ id: '', l: 'Total', n: rows.length }].concat(RAPIDOS[hoja.id].map(x => ({ id: x.id, l: x.l, n: rows.filter(x.f).length })));
    $('#stats').replaceChildren(...items.map(x => el('button', {
      type: 'button', class: 'stat' + (v.quick === x.id ? ' on' : ''), 'data-quick': x.id, 'aria-pressed': v.quick === x.id ? 'true' : 'false'
    }, el('span', { class: 'n', text: fmt(x.n) }), el('span', { class: 'l', text: x.l }))));
    const rapido = v.quick && RAPIDOS[hoja.id].find(x => x.id === v.quick);
    $('#quickInfo').hidden = !rapido;
    if (rapido) $('#quickInfo').replaceChildren(`Mostrando solo: ${rapido.l}. `, el('button', { type: 'button', class: 'linkbtn', 'data-quick': '', text: 'Quitar filtro' }));
  }
  function renderFiltro(hoja) {
    const v = state.vista[hoja.id];
    $('#filtroWrap').hidden = !hoja.filtro;
    if (!hoja.filtro) return;
    $('#filtroLabel').textContent = hoja.filtro.h;
    const map = new Map();
    state.data[hoja.id].forEach(r => { const n = norm(r[hoja.filtro.k]); if (n && !map.has(n)) map.set(n, str(r[hoja.filtro.k]).trim()); });
    const opts = [...map].sort((a, b) => a[1].localeCompare(b[1], 'es'));
    $('#filtro').replaceChildren(el('option', { value: '', text: 'Todos' }), ...opts.map(([n, l]) => el('option', { value: n, text: l })));
    $('#filtro').value = map.has(v.filtro) ? v.filtro : '';
  }
  function renderHead(hoja) {
    const v = state.vista[hoja.id];
    const tr = el('tr');
    hoja.visibles.forEach(k => {
      const c = hoja.campos.find(x => x.k === k);
      const arrow = v.sort.k === k ? (v.sort.dir === 1 ? '▲' : '▼') : '';
      const th = el('th', { scope: 'col', 'aria-sort': v.sort.k === k ? (v.sort.dir === 1 ? 'ascending' : 'descending') : null },
        el('button', { type: 'button', 'data-sort': k, text: c.h }, arrow ? el('span', { text: arrow, 'aria-hidden': 'true' }) : null));
      tr.append(th);
    });
    tr.append(el('th', { scope: 'col', style: 'text-align:right', text: 'Acciones' }));
    $('#tbl thead').replaceChildren(tr);
  }
  function renderBody(hoja) {
    const v = state.vista[hoja.id];
    const all = filtrados(hoja);
    const pages = Math.max(1, Math.ceil(all.length / v.pageSize));
    v.page = Math.min(Math.max(1, v.page), pages);
    const slice = all.slice((v.page - 1) * v.pageSize, v.page * v.pageSize);
    const tbody = $('#tbl tbody');
    tbody.replaceChildren();
    if (!slice.length) tbody.append(el('tr', null, el('td', { colspan: hoja.visibles.length + 1, class: 'vacio', text: 'No hay registros que coincidan con la búsqueda.' })));
    slice.forEach(r => {
      const tr = el('tr');
      hoja.visibles.forEach(k => {
        const c = hoja.campos.find(x => x.k === k);
        const cls = k === 'nombre' ? 'nombre' : (c.type === 'rut' || c.type === 'phone' || c.type === 'code' || c.type === 'datetext' || k === 'serie') ? 'nw' : (c.type === 'long' ? 'largo' : null);
        tr.append(el('td', { class: cls, text: mostrar(c, r[k]) }));
      });
      const nom = str(r.nombre) || str(r.serie) || 'registro';
      tr.append(el('td', { class: 'acc' },
        el('button', { class: 'btn small', 'data-act': 'view', 'data-id': r._id, 'aria-label': 'Ver ' + nom, text: 'Ver' }),
        el('button', { class: 'btn small', 'data-act': 'edit', 'data-id': r._id, 'aria-label': 'Editar ' + nom, text: 'Editar' }),
        state.isAdmin ? el('button', { class: 'btn small danger', 'data-act': 'del', 'data-id': r._id, 'aria-label': 'Eliminar ' + nom, text: 'Eliminar' }) : null));
      tbody.append(tr);
    });
    const total = state.data[hoja.id].length;
    $('#count').textContent = all.length === total ? `${fmt(all.length)} registros` : `${fmt(all.length)} de ${fmt(total)} registros`;
    $('#pageInfo').textContent = `Página ${v.page} de ${pages}`;
    $('#prev').disabled = v.page <= 1;
    $('#next').disabled = v.page >= pages;
  }
  function renderHoja() {
    const hoja = hojaActual();
    const v = state.vista[hoja.id];
    $('#q').value = v.q;
    $('#pageSize').value = String(v.pageSize);
    $('#newBtn').textContent = '+ ' + hoja.nuevo;
    renderStats(hoja); renderFiltro(hoja); renderHead(hoja); renderBody(hoja);
  }

  /* ---------- Ficha por persona ---------- */
  function personas() {
    const map = new Map();
    HOJAS.forEach(h => state.data[h.id].forEach(r => {
      const key = personaKey(r);
      if (!key) return;
      let p = map.get(key);
      if (!p) { p = { key, nombre: '', rut: '', hojas: {} }; map.set(key, p); }
      if (!p.nombre && r.nombre) p.nombre = r.nombre;
      if (!p.rut && r.rut) p.rut = r.rut;
      (p.hojas[h.id] = p.hojas[h.id] || []).push(r);
    }));
    return map;
  }
  function renderFicha() {
    const q = norm(state.fichaQ), qr = rutClean(state.fichaQ);
    const res = $('#fichaResultados'), det = $('#fichaDetalle');
    const mapa = personas();
    if (state.fichaKey && mapa.has(state.fichaKey)) {
      res.hidden = true;
      det.replaceChildren(fichaDetalle(mapa.get(state.fichaKey)));
      return;
    }
    state.fichaKey = null;
    det.replaceChildren();
    res.hidden = false;
    if (q.length < 2) {
      res.replaceChildren(el('p', { class: 'ayuda', text: `Escribe al menos 2 letras del nombre o parte del RUT. Se busca en las 4 hojas a la vez (${fmt(mapa.size)} personas registradas).` }));
      return;
    }
    const hits = [...mapa.values()].filter(p =>
      (pareceRut(state.fichaQ) && rutClean(p.rut).includes(qr)) ||
      HOJAS.some(h => (p.hojas[h.id] || []).some(r => norm(r.nombre).includes(q))));
    hits.sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
    if (!hits.length) { res.replaceChildren(el('p', { class: 'ayuda', text: 'No se encontró a nadie con esa búsqueda.' })); return; }
    const lista = el('ul', { class: 'personas' }, ...hits.slice(0, 50).map(p => el('li', null,
      el('button', { type: 'button', class: 'persona', 'data-persona': p.key },
        el('span', { class: 'pn', text: p.nombre || '(sin nombre)' }),
        el('span', { class: 'pr', text: p.rut || 'sin RUT' }),
        el('span', { class: 'badges' }, ...HOJAS.map(h => el('span', { class: 'badge' + (p.hojas[h.id] ? ' si' : ''), text: (p.hojas[h.id] ? '✓ ' : '✗ ') + h.titulo })))))));
    res.replaceChildren(el('p', { class: 'ayuda', text: hits.length > 50 ? `${fmt(hits.length)} personas encontradas; se muestran las primeras 50. Escribe más para afinar.` : `${hits.length} ${hits.length === 1 ? 'persona encontrada' : 'personas encontradas'}.` }), lista);
  }
  function fichaDetalle(p) {
    const wrap = el('div', { class: 'ficha' });
    wrap.append(el('div', { class: 'panel fichahead' },
      el('div', null, el('h2', { text: p.nombre || '(sin nombre)' }), el('p', { class: 'sub', text: p.rut ? 'RUT ' + p.rut : 'Sin RUT' })),
      el('button', { type: 'button', class: 'btn', 'data-action': 'ficha-volver', text: '‹ Volver a la búsqueda' })));
    HOJAS.forEach(h => {
      const recs = p.hojas[h.id] || [];
      const sec = el('section', { class: 'panel fichasec' + (recs.length ? '' : ' vacia') },
        el('h3', null, h.titulo, el('span', { class: 'badge' + (recs.length ? ' si' : ''), text: recs.length ? (recs.length > 1 ? `${recs.length} registros` : 'Sí') : 'No está' })));
      recs.forEach(r => {
        sec.append(el('dl', { class: 'detail' }, ...h.campos.flatMap(c => [el('dt', { text: c.h }), el('dd', { text: mostrar(c, r[c.k]) || '—' })])));
        sec.append(el('div', { class: 'row end' },
          el('button', { type: 'button', class: 'btn small', 'data-act': 'edit', 'data-hoja': h.id, 'data-id': r._id, text: 'Editar' }),
          state.isAdmin ? el('button', { type: 'button', class: 'btn small danger', 'data-act': 'del', 'data-hoja': h.id, 'data-id': r._id, text: 'Eliminar' }) : null));
      });
      if (!recs.length) {
        sec.append(el('div', { class: 'row' }, el('button', { type: 'button', class: 'btn small', 'data-action': 'ficha-agregar', 'data-hoja': h.id, text: `+ Agregar a ${h.titulo}` })));
      }
      wrap.append(sec);
    });
    return wrap;
  }
  function abrirFicha(r) {
    const key = personaKey(r);
    if (!key) return toast('Este registro no tiene nombre ni RUT.');
    state.fichaKey = key;
    state.fichaQ = r.rut || r.nombre || '';
    setTab('ficha');
    window.scrollTo(0, 0);
  }

  function refresh() {
    const ready = !!state.userId && state.loaded;
    const has = ready && (totalRegistros() > 0 || state.started);
    $('#emptyState').hidden = !ready || has;
    $('#app').hidden = !has;
    if (!has) return;
    renderTabs();
    $('#vistaFicha').hidden = state.tab !== 'ficha';
    $('#vistaHoja').hidden = state.tab === 'ficha';
    $('#vistaFicha').setAttribute('aria-labelledby', 'tab-ficha');
    $('#vistaHoja').setAttribute('aria-labelledby', 'tab-' + state.tab);
    if (state.tab === 'ficha') { $('#fq').value = state.fichaQ; renderFicha(); } else renderHoja();
  }

  /* ---------- Formulario ---------- */
  const buscar = (hojaId, id) => state.data[hojaId].find(x => String(x._id) === String(id));
  function sugerencias(hoja, k) {
    const set = new Map();
    state.data[hoja.id].forEach(r => { const n = norm(r[k]); if (n && !set.has(n) && !isIso(r[k])) set.set(n, str(r[k]).trim()); });
    return [...set.values()].slice(0, 200);
  }
  function openForm(hojaId, id, prefill) {
    const hoja = HOJA[hojaId];
    const r = id ? buscar(hojaId, id) : null;
    state.editing = { hoja: hojaId, id: r ? r._id : null };
    state.confirmWarn = '';
    $('#formTitle').textContent = (r ? 'Modificar ' + hoja.singular : hoja.nuevo) + ' · ' + hoja.titulo;
    const grid = $('#formGrid');
    grid.replaceChildren();
    const base = r || Object.assign(valoresNuevos(hoja), prefill || {});
    hoja.campos.forEach(c => {
      const fid = 'f_' + c.k;
      const req = c.k === 'nombre' && hoja.rutObligatorio || c.k === 'rut' && hoja.rutObligatorio;
      const label = el('label', { for: fid, text: c.h + (req ? ' *' : '') });
      let input;
      const val = mostrar(c, base[c.k]);
      if (c.opciones) {
        const raw = str(base[c.k]).trim();
        const actual = c.opciones.find(o => norm(o) === norm(raw)) || raw;
        const extra = actual && !c.opciones.includes(actual) ? [actual] : [];
        input = el('select', { id: fid },
          el('option', { value: '', text: '— Sin dato —' }),
          ...c.opciones.map(o => el('option', { value: o, text: o })),
          ...extra.map(o => el('option', { value: o, text: o + ' (valor actual)' })),
          el('option', { value: '__otra', text: c.otro || 'Otra (escribir)…' }));
        input.value = actual;
        const otra = el('input', { id: fid + '_otra', autocomplete: 'off', placeholder: 'Escríbelo aquí', 'aria-label': c.h + ' (otra)', hidden: true });
        input.addEventListener('change', () => { otra.hidden = input.value !== '__otra'; if (!otra.hidden) otra.focus(); });
        grid.append(el('div', { class: 'field' }, label, input, otra));
        return;
      }
      if (c.type === 'long') input = el('textarea', { id: fid, rows: '2' });
      else if (c.type === 'int') input = el('input', { id: fid, type: 'number', min: '0', max: '120' });
      else {
        input = el('input', { id: fid, autocomplete: 'off', inputmode: c.type === 'phone' ? 'tel' : null, placeholder: c.type === 'rut' ? '12.345.678-9' : c.type === 'datetext' ? 'dd-mm-aaaa o texto' : null });
        if (['observacion', 'observacion2', 'organizacion', 'quien_inscribe'].includes(c.k)) {
          const dl = el('datalist', { id: 'dl_' + c.k }, ...sugerencias(hoja, c.k).map(s => el('option', { value: s })));
          input.setAttribute('list', 'dl_' + c.k);
          label.append(dl);
        }
      }
      input.value = val;
      const field = el('div', { class: 'field' + (c.k === 'nombre' || c.type === 'long' ? ' span2' : '') }, label);
      if (c.type === 'datetext') {
        field.append(el('div', { class: 'inline' }, input, el('button', { type: 'button', class: 'btn small', 'data-hoy': fid, text: 'Hoy' })));
      } else field.append(input);
      grid.append(field);
    });
    setMsg('');
    $('#dlgForm').showModal();
    const first = $('#f_nombre'); if (first) first.focus();
  }
  function valoresNuevos(hoja) {
    const o = {};
    hoja.campos.forEach(c => { o[c.k] = c.type === 'int' ? null : ''; });
    if (hoja.id === 'inscritos') o.fecha_inscripcion = hoyIso();
    if (hoja.id === 'beneficiarios') o.fecha_revision = hoyIso();
    if (hoja.id === 'reimpresiones') o.fecha_retiro = '';
    if (hoja.id === 'tarjetas') {
      const max = state.data.tarjetas.reduce((m, r) => (/^\d+$/.test(r.numero) ? Math.max(m, +r.numero) : m), 0);
      o.numero = String(max + 1);
    }
    return o;
  }
  function setMsg(text, warn) {
    const m = $('#formMsg'); m.textContent = text; m.classList.toggle('warn', !!warn);
  }
  async function submitForm(ev) {
    ev.preventDefault();
    const { hoja: hojaId, id } = state.editing;
    const hoja = HOJA[hojaId];
    const F = k => $('#f_' + k);
    hoja.campos.forEach(c => F(c.k).removeAttribute('aria-invalid'));
    const fail = (k, msg) => { F(k).setAttribute('aria-invalid', 'true'); F(k).focus(); setMsg(msg); };
    const rec = {};
    hoja.campos.forEach(c => {
      let val = F(c.k).value;
      if (val === '__otra') val = F(c.k + '_otra').value;
      rec[c.k] = celda(c, val);
    });
    if (hoja.rutObligatorio && !rec.nombre) return fail('nombre', 'El nombre es obligatorio.');
    if (hoja.rutObligatorio && !rec.rut) return fail('rut', 'El RUT es obligatorio.');
    if (!hoja.rutObligatorio && !rec.nombre && !rec.rut && !rec.serie && !rec.identificador) return fail('nombre', 'Completa al menos el nombre, el RUT, el N° de serie o el identificador.');
    const edadTxt = F('edad') ? F('edad').value.trim() : '';
    if (edadTxt !== '' && (!Number.isInteger(Number(edadTxt)) || +edadTxt < 0 || +edadTxt > 120)) return fail('edad', 'La edad debe ser un número entero entre 0 y 120.');
    // Avisos que se pueden aceptar volviendo a pulsar Guardar
    const avisos = [];
    if (rec.rut) {
      const st = rutStatus(rec.rut);
      if (!st.format) return fail('rut', 'El RUT no tiene un formato válido (ejemplo: 12.345.678-9).');
      rec.rut = rutFormat(rec.rut);
      if (!st.ok) avisos.push(`el dígito verificador del RUT no coincide (debería ser ${st.dv})`);
      const dup = state.data[hojaId].find(r => rutClean(r.rut) === rutClean(rec.rut) && r._id !== id);
      if (dup) avisos.push(`ya existe ${dup.nombre || 'un registro'} con ese RUT en ${hoja.titulo}`);
    }
    if (hojaId === 'tarjetas' && rec.serie) {
      const dupS = state.data.tarjetas.find(r => norm(r.serie) === norm(rec.serie) && r._id !== id);
      if (dupS) avisos.push(`el N° de serie ya está asignado a ${dupS.nombre || 'otra tarjeta'}`);
    }
    const firma = avisos.join('|');
    if (avisos.length && state.confirmWarn !== firma) {
      state.confirmWarn = firma;
      return setMsg('Atención: ' + avisos.join('; ') + '. Revisa los datos o pulsa «Guardar» otra vez para guardar de todos modos.', true);
    }
    const btn = $('#saveBtn');
    btn.disabled = true;
    try {
      if (id) {
        const { data, error } = await db.from(hoja.tabla).update(toDb(hoja, rec)).eq('id', id).select().single();
        if (error) throw error;
        const i = state.data[hojaId].findIndex(x => x._id === id);
        if (i >= 0) state.data[hojaId][i] = fromDb(hoja, data);
        toast('Registro modificado.');
      } else {
        rec.orden = state.data[hojaId].reduce((m, r) => Math.max(m, r.orden || 0), 0) + 1;
        const { data, error } = await db.from(hoja.tabla).insert(toDb(hoja, rec)).select().single();
        if (error) throw error;
        state.data[hojaId].push(fromDb(hoja, data));
        toast(`Registro agregado a ${hoja.titulo}.`);
      }
    } catch (e) {
      btn.disabled = false;
      return setMsg('No se pudo guardar: ' + (e.message || e));
    }
    btn.disabled = false;
    if (hojaId === 'inscritos') {
      const antes = state.data.beneficiarios.length;
      try { state.data.beneficiarios = await loadTabla(HOJA.beneficiarios); } catch (e) { /* se verá al recargar */ }
      if (state.data.beneficiarios.length > antes) toast('Cumple: también se agregó a Beneficiarios Finales.', 5000);
    }
    indexar();
    if (state.fichaKey) state.fichaKey = personaKey(rec) || state.fichaKey;
    $('#dlgForm').close(); refresh();
  }

  /* ---------- Ver / eliminar ---------- */
  function openView(hojaId, id) {
    const hoja = HOJA[hojaId], r = buscar(hojaId, id); if (!r) return;
    state.viewing = { hoja: hojaId, id: r._id };
    $('#viewTitle').textContent = r.nombre || r.serie || '(sin nombre)';
    $('#viewHoja').textContent = hoja.titulo;
    $('#viewBody').replaceChildren(...hoja.campos.flatMap(c => [el('dt', { text: c.h }), el('dd', { text: mostrar(c, r[c.k]) || '—' })]));
    $('#viewFicha').hidden = !personaKey(r);
    $('#dlgView').showModal();
  }
  function openDelete(hojaId, id) {
    const hoja = HOJA[hojaId], r = buscar(hojaId, id); if (!r) return;
    state.deleting = { hoja: hojaId, id: r._id };
    $('#delText').textContent = `¿Eliminar a ${r.nombre || 'este registro'}${r.rut ? ' (RUT ' + r.rut + ')' : ''} de «${hoja.titulo}»? Solo se borra de esta hoja. Esta acción no se puede deshacer.`;
    $('#dlgDelete').showModal();
  }

  /* ---------- Eventos ---------- */
  document.addEventListener('click', ev => {
    const t = ev.target.closest('[data-action],[data-act],[data-sort],[data-close],[data-tab],[data-quick],[data-persona],[data-hoy]');
    if (!t) return;
    if (t.dataset.close !== undefined) return t.closest('dialog').close();
    if (t.dataset.tab) return setTab(t.dataset.tab);
    if (t.dataset.hoy) { $('#' + t.dataset.hoy).value = fechaTexto(hoyIso()); return; }
    if (t.dataset.persona) { state.fichaKey = t.dataset.persona; window.scrollTo(0, 0); return refresh(); }
    if (t.dataset.quick !== undefined) {
      const v = state.vista[state.tab];
      v.quick = v.quick === t.dataset.quick ? '' : t.dataset.quick; v.page = 1;
      return renderHoja();
    }
    if (t.dataset.sort) {
      const v = state.vista[state.tab], k = t.dataset.sort;
      v.sort = v.sort.k === k ? (v.sort.dir === 1 ? { k, dir: -1 } : { k: null, dir: 1 }) : { k, dir: 1 };
      return renderHoja();
    }
    if (t.dataset.act) {
      const hojaId = t.dataset.hoja || state.tab, id = t.dataset.id;
      if (t.dataset.act === 'del' && !state.isAdmin) return;
      return t.dataset.act === 'view' ? openView(hojaId, id) : t.dataset.act === 'edit' ? openForm(hojaId, id) : openDelete(hojaId, id);
    }
    switch (t.dataset.action) {
      case 'new': return openForm(state.tab, null);
      case 'import': return state.isAdmin ? $('#file').click() : toast('Solo un administrador puede cargar el Excel.');
      case 'forgot': return forgotPassword();
      case 'export': return exportExcel();
      case 'start-empty': state.started = true; return refresh();
      case 'logout': return db.auth.signOut();
      case 'ficha-volver': state.fichaKey = null; refresh(); return $('#fq').focus();
      case 'ficha-agregar': {
        const p = personas().get(state.fichaKey); if (!p) return;
        const otro = HOJAS.map(h => (p.hojas[h.id] || [])[0]).find(Boolean) || {};
        const pre = { nombre: p.nombre, rut: p.rut };
        ['edad', 'telefono'].forEach(k => { if (otro[k] != null && otro[k] !== '' && HOJA[t.dataset.hoja].campos.some(c => c.k === k)) pre[k] = otro[k]; });
        if (t.dataset.hoja === 'reimpresiones' || t.dataset.hoja === 'tarjetas') {
          const tj = (p.hojas.tarjetas || [])[0];
          if (tj && t.dataset.hoja === 'reimpresiones') Object.assign(pre, { numero: tj.numero });
        }
        return openForm(t.dataset.hoja, null, pre);
      }
    }
  });
  $('#tabs').addEventListener('keydown', e => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
    const ids = ['ficha', ...HOJAS.map(h => h.id)];
    let i = ids.indexOf(state.tab);
    i = e.key === 'Home' ? 0 : e.key === 'End' ? ids.length - 1 : (i + (e.key === 'ArrowRight' ? 1 : -1) + ids.length) % ids.length;
    e.preventDefault(); setTab(ids[i]); $('#tab-' + ids[i]).focus();
  });
  $('#file').addEventListener('change', e => { const f = e.target.files[0]; e.target.value = ''; handleFile(f); });
  $('#form').addEventListener('submit', submitForm);
  $('#form').addEventListener('input', e => { e.target.removeAttribute('aria-invalid'); state.confirmWarn = ''; if (!$('#formMsg').classList.contains('warn')) setMsg(''); });
  $('#form').addEventListener('focusout', e => {
    if (e.target.id !== 'f_rut') return;
    const v = e.target.value.trim(); if (!v) return;
    const st = rutStatus(v);
    if (st.format) e.target.value = rutFormat(v);
    if (st.format && !st.ok) setMsg(`Aviso: el dígito verificador no coincide (debería ser ${st.dv}).`, true);
  });
  $('#viewEdit').addEventListener('click', () => { $('#dlgView').close(); openForm(state.viewing.hoja, state.viewing.id); });
  $('#viewFicha').addEventListener('click', () => { $('#dlgView').close(); abrirFicha(buscar(state.viewing.hoja, state.viewing.id)); });
  $('#delConfirm').addEventListener('click', async () => {
    const { hoja: hojaId, id } = state.deleting;
    try {
      const { error } = await db.from(HOJA[hojaId].tabla).delete().eq('id', id);
      if (error) throw error;
      state.data[hojaId] = state.data[hojaId].filter(r => r._id !== id);
      indexar();
      $('#dlgDelete').close(); refresh(); toast('Registro eliminado.');
    } catch (e) {
      toast('No se pudo eliminar: ' + (e.message || e));
    }
  });
  $('#impConfirm').addEventListener('click', () => { $('#dlgImport').close(); confirmImport(); });

  let tmr, ftmr;
  $('#q').addEventListener('input', e => { clearTimeout(tmr); tmr = setTimeout(() => { const v = state.vista[state.tab]; v.q = e.target.value; v.page = 1; renderBody(hojaActual()); }, 150); });
  $('#fq').addEventListener('input', e => { clearTimeout(ftmr); ftmr = setTimeout(() => { state.fichaQ = e.target.value; state.fichaKey = null; renderFicha(); }, 150); });
  $('#filtro').addEventListener('change', e => { const v = state.vista[state.tab]; v.filtro = e.target.value; v.page = 1; renderBody(hojaActual()); });
  $('#pageSize').addEventListener('change', e => { const v = state.vista[state.tab]; v.pageSize = Number(e.target.value); v.page = 1; renderBody(hojaActual()); });
  $('#prev').addEventListener('click', () => { state.vista[state.tab].page--; renderBody(hojaActual()); });
  $('#next').addEventListener('click', () => { state.vista[state.tab].page++; renderBody(hojaActual()); });

  /* ---------- Sesión (inicio / cierre) ---------- */
  function showLogin(msg) {
    document.body.classList.remove('is-admin');
    $('#setPass').hidden = true;
    $('#login').hidden = false;
    $('#session').hidden = true;
    $('#loginMsg').textContent = msg || '';
    refresh();
  }
  async function onSession(session) {
    if (!session) {
      state.userId = null; state.isAdmin = false; state.loaded = false; state.started = false;
      HOJAS.forEach(h => { state.data[h.id] = []; });
      return showLogin();
    }
    if (needPassword) {
      state.userId = null;
      $('#login').hidden = true; $('#session').hidden = true; $('#setPass').hidden = false;
      $('#spMsg').textContent = '';
      refresh();
      return;
    }
    if (state.userId === session.user.id) return;
    state.userId = session.user.id;
    state.isAdmin = (session.user.app_metadata || {}).role === 'admin';
    document.body.classList.toggle('is-admin', state.isAdmin);
    $('#login').hidden = true;
    $('#setPass').hidden = true;
    $('#session').hidden = false;
    $('#userEmail').textContent = (session.user.email || '') + (state.isAdmin ? ' · administrador' : '');
    toast('Cargando datos…');
    try { await loadAll(); }
    catch (e) { toast('No se pudieron cargar los datos: ' + (e.message || e), 7000); }
    refresh();
  }
  $('#loginForm').addEventListener('submit', async ev => {
    ev.preventDefault();
    const btn = $('#loginBtn');
    btn.disabled = true; $('#loginMsg').textContent = '';
    const { error } = await db.auth.signInWithPassword({
      email: $('#l_email').value.trim(), password: $('#l_pass').value
    });
    btn.disabled = false;
    if (error) {
      $('#loginMsg').textContent = /invalid/i.test(error.message)
        ? 'Correo o contraseña incorrectos.' : 'No se pudo iniciar sesión: ' + error.message;
    } else { $('#l_pass').value = ''; }
  });
  $('#setPassForm').addEventListener('submit', async ev => {
    ev.preventDefault();
    const p1 = $('#sp_1').value, p2 = $('#sp_2').value, msg = $('#spMsg');
    if (p1.length < 8) { msg.textContent = 'La contraseña debe tener al menos 8 caracteres.'; return; }
    if (p1 !== p2) { msg.textContent = 'Las contraseñas no coinciden.'; return; }
    const btn = $('#spBtn'); btn.disabled = true; msg.textContent = '';
    needPassword = false;
    const { error } = await db.auth.updateUser({ password: p1 });
    btn.disabled = false;
    if (error) {
      needPassword = true;
      msg.textContent = 'No se pudo guardar la contraseña: ' + error.message;
      return;
    }
    $('#sp_1').value = ''; $('#sp_2').value = '';
    history.replaceState(null, '', location.pathname + location.search);
    toast('Contraseña creada. Ya puedes usar la plataforma.');
    const { data } = await db.auth.getSession();
    onSession(data.session);
  });
  async function forgotPassword() {
    const email = $('#l_email').value.trim();
    if (!email) { $('#loginMsg').textContent = 'Escribe tu correo arriba y vuelve a pulsar «Olvidé mi contraseña».'; return; }
    const { error } = await db.auth.resetPasswordForEmail(email, { redirectTo: location.origin + location.pathname });
    $('#loginMsg').textContent = error
      ? 'No se pudo enviar el correo: ' + error.message
      : 'Si el correo está registrado, te enviamos un enlace para crear una nueva contraseña.';
  }
  // Al volver a la pestaña, refresca los datos si pasaron más de 2 minutos
  document.addEventListener('visibilitychange', async () => {
    if (document.hidden || !state.userId || Date.now() - state.lastLoad < 120000) return;
    if (document.querySelector('dialog[open]')) return;
    try { await loadAll(); refresh(); } catch (e) { /* se reintenta la próxima vez */ }
  });

  if (!CFG.SUPABASE_URL || !CFG.SUPABASE_ANON_KEY || /PEGAR/.test(CFG.SUPABASE_ANON_KEY)) {
    showLogin('Falta configurar la clave de Supabase en js/config.js.');
  } else {
    db.auth.onAuthStateChange((ev, session) => {
      if (ev === 'PASSWORD_RECOVERY') needPassword = true;
      setTimeout(() => onSession(session), 0);
    });
    if (linkError) showLogin('El enlace del correo no es válido o expiró. Usa «Olvidé mi contraseña» para recibir uno nuevo.');
    db.auth.getSession().then(({ data }) => onSession(data.session));
  }
})();
