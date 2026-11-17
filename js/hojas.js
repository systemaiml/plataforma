/* Definición de las 4 hojas del Excel «Tarjeta Personas Mayores Oficial» y lectura de sus filas.
   Se usa en la página y también para la carga inicial de datos. */
(function (global) {
  'use strict';

  // type: text | int | rut | phone | code | datetext (fecha AAAA-MM-DD o texto libre) | long (texto de varias líneas)
  const HOJAS = [
    {
      id: 'inscritos', tabla: 'inscritos', titulo: 'Inscritos', excel: 'Inscritos', singular: 'inscrito', nuevo: 'Nuevo inscrito',
      match: n => /inscrit/.test(n),
      rutObligatorio: true,
      campos: [
        { k: 'fecha_inscripcion', h: 'Fecha inscripción', type: 'datetext', pos: 0, keys: ['fecha'] },
        { k: 'nombre', h: 'Nombre Completo', pos: 1, keys: ['nombre'] },
        { k: 'rut', h: 'Rut', type: 'rut', pos: 2, keys: ['rut'] },
        { k: 'edad', h: 'Edad', type: 'int', pos: 3, keys: ['edad'] },
        { k: 'telefono', h: 'Número de contacto', type: 'phone', pos: 4, keys: ['contacto', 'telefono'] },
        { k: 'observacion', h: 'Observación', pos: 5, keys: ['observacion'] },
        { k: 'quien_inscribe', h: 'Quién inscribe', pos: 6, keys: ['quien', 'inscribe'] },
        { k: 'notas', h: 'Notas', type: 'long', pos: 7, keys: ['notas'] }
      ],
      visibles: ['fecha_inscripcion', 'nombre', 'rut', 'edad', 'telefono', 'observacion', 'quien_inscribe', 'notas'],
      filtro: { k: 'observacion', h: 'Observación' },
      anchos: [14, 38, 13, 7, 18, 24, 16, 30]
    },
    {
      id: 'beneficiarios', tabla: 'beneficiarios', titulo: 'Beneficiarios Finales', excel: 'Beneficiarios Finales', singular: 'beneficiario', nuevo: 'Nuevo beneficiario',
      match: n => /benefici/.test(n),
      rutObligatorio: true,
      campos: [
        { k: 'fecha_revision', h: 'Fecha revisión', type: 'datetext', pos: 0, keys: ['fecha', 'revision'] },
        { k: 'nombre', h: 'Nombre Completo', pos: 1, keys: ['nombre'] },
        { k: 'rut', h: 'Rut', type: 'rut', pos: 2, keys: ['rut'] },
        { k: 'edad', h: 'Edad', type: 'int', pos: 3, keys: ['edad'] },
        { k: 'telefono', h: 'Número de contacto', type: 'phone', pos: 4, keys: ['contacto', 'telefono'] },
        { k: 'observacion', h: 'Observación', pos: 5, keys: ['observacion'] },
        { k: 'observacion2', h: 'Observación 2', pos: 6, keys: ['observacion 2', 'observacion2'] },
        { k: 'notas', h: 'Notas', type: 'long', pos: 7, keys: ['notas'] }
      ],
      visibles: ['fecha_revision', 'nombre', 'rut', 'edad', 'telefono', 'observacion', 'observacion2'],
      filtro: { k: 'observacion2', h: 'Observación 2' },
      anchos: [14, 38, 13, 7, 18, 16, 30, 30]
    },
    {
      id: 'tarjetas', tabla: 'tarjetas', titulo: 'Tarjetas Impresas', excel: 'Tarjetas Impresas', singular: 'tarjeta', nuevo: 'Nueva tarjeta',
      match: n => /impres/.test(n) && !/re ?impres/.test(n),
      rutObligatorio: false,
      campos: [
        { k: 'numero', h: 'N°', type: 'code', pos: 0, keys: ['n°', 'numero', 'correlativo'] },
        { k: 'identificador', h: 'Identificador', type: 'code', pos: 1, keys: ['identificador'] },
        { k: 'serie', h: 'Nº Serie', pos: 2, keys: ['serie'] },
        { k: 'nombre', h: 'Nombre persona', pos: 3, keys: ['nombre'] },
        { k: 'rut', h: 'RUT', type: 'rut', pos: 4, keys: ['rut'] },
        { k: 'organizacion', h: 'Organización', pos: 5, keys: ['organizacion'] },
        { k: 'entrega', h: 'Fecha entrega', type: 'datetext', pos: 6, keys: ['entrega'] },
        { k: 'observacion', h: 'Observación', pos: 7, keys: ['observacion'] }
      ],
      visibles: ['numero', 'identificador', 'serie', 'nombre', 'rut', 'organizacion', 'entrega', 'observacion'],
      filtro: { k: 'organizacion', h: 'Organización' },
      anchos: [8, 14, 12, 38, 13, 30, 16, 28]
    },
    {
      id: 'reimpresiones', tabla: 'reimpresiones', titulo: 'Tarjetas reimpresas', excel: 'Tarjeta re impresas', singular: 'reimpresión', nuevo: 'Nueva reimpresión',
      match: n => /re ?impres/.test(n),
      rutObligatorio: false,
      campos: [
        { k: 'numero', h: 'N°', type: 'code', pos: 0, keys: ['n°', 'numero', 'correlativo'] },
        { k: 'identificador', h: 'Identificador', type: 'code', pos: 1, keys: ['identificador'] },
        { k: 'serie', h: 'Nº Serie', pos: 2, keys: ['serie'] },
        { k: 'nombre', h: 'Nombre persona', pos: 3, keys: ['nombre'] },
        { k: 'rut', h: 'RUT', type: 'rut', pos: 4, keys: ['rut'] },
        { k: 'fecha_retiro', h: 'Fecha retiro', type: 'datetext', pos: 5, keys: ['retiro'] },
        { k: 'observacion', h: 'Observación', pos: 6, keys: ['observacion'] }
      ],
      visibles: ['numero', 'identificador', 'serie', 'nombre', 'rut', 'fecha_retiro', 'observacion'],
      filtro: null,
      anchos: [8, 14, 12, 38, 13, 14, 34]
    }
  ];

  const norm = s => String(s == null ? '' : s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim();
  const rutClean = s => String(s == null ? '' : s).replace(/[^0-9kK]/g, '').toUpperCase();
  function rutFormat(s) {
    const c = rutClean(s);
    if (c.length < 7 || c.length > 9 || !/^\d+[0-9K]$/.test(c)) return String(s == null ? '' : s).trim();
    return c.slice(0, -1).replace(/\B(?=(\d{3})+(?!\d))/g, '.') + '-' + c.slice(-1);
  }
  function serialToIso(n) {
    return new Date(Math.round(n) * 86400000 + Date.UTC(1899, 11, 30)).toISOString().slice(0, 10);
  }
  const numText = v => (Number.isInteger(v) ? String(v) : String(v)).replace(/\.0+$/, '');

  // Convierte el valor de una celda al formato del campo
  function celda(campo, v) {
    const t = campo.type || 'text';
    if (v == null) return t === 'int' ? null : '';
    if (typeof v === 'boolean') v = v ? 'Sí' : 'No';
    if (t === 'int') {
      const n = typeof v === 'number' ? v : Number(String(v).replace(',', '.').trim());
      return String(v).trim() === '' || !isFinite(n) ? null : Math.round(n);
    }
    if (typeof v === 'number') {
      if (t === 'datetext' && v > 20000 && v < 80000) return serialToIso(v);
      if (t === 'rut') return rutFormat(numText(v));
      return Number.isInteger(v) ? String(v) : numText(v);
    }
    const s = t === 'long' ? String(v).trim() : String(v).replace(/\s+/g, ' ').trim();
    if (t === 'rut') return rutFormat(s);
    if (t === 'datetext') {
      const m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/.exec(s);
      if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
      const iso = /^(\d{4})-(\d{2})-(\d{2})(?:[T ]\d{2}:\d{2}(?::\d{2})?)?$/.exec(s);
      if (iso) return s.slice(0, 10);
    }
    return s;
  }

  // Decide qué columna del Excel corresponde a cada campo (por encabezado, si no por posición)
  function mapear(hoja, encabezado) {
    const head = (encabezado || []).map(norm);
    const usado = new Set(), idx = {};
    const buscar = (campo, exacto) => head.findIndex((h, j) => !usado.has(j) && h &&
      [norm(campo.h), ...campo.keys].some(key => exacto ? h === key : h.includes(key)));
    for (const exacto of [true, false]) {
      hoja.campos.forEach(c => {
        if (c.k in idx) return;
        const j = buscar(c, exacto);
        if (j >= 0) { idx[c.k] = j; usado.add(j); }
      });
    }
    hoja.campos.forEach(c => {
      if (!(c.k in idx) && !usado.has(c.pos)) { idx[c.k] = c.pos; usado.add(c.pos); }
    });
    return idx;
  }

  // filas: matriz de la hoja (fila 0 = encabezados). Devuelve registros listos para la base.
  function leerHoja(hoja, filas) {
    const idx = mapear(hoja, filas[0]);
    const out = [];
    for (let r = 1; r < filas.length; r++) {
      const fila = filas[r] || [];
      const o = {};
      hoja.campos.forEach(c => { o[c.k] = idx[c.k] == null ? (c.type === 'int' ? null : '') : celda(c, fila[idx[c.k]]); });
      const conDatos = hoja.campos.some(c => c.k !== 'numero' && o[c.k] != null && o[c.k] !== '');
      if (!conDatos) continue;
      o.orden = out.length + 1;
      out.push(o);
    }
    return out;
  }

  // libro: [{name, rows}] → { inscritos: [...], ... } solo con las hojas encontradas
  function leerLibro(libro) {
    const res = {}, nombres = {};
    HOJAS.forEach(h => {
      const s = libro.find(x => h.match(norm(x.name)) && !Object.values(nombres).includes(x.name));
      if (s) { res[h.id] = leerHoja(h, s.rows); nombres[h.id] = s.name; }
    });
    return { datos: res, nombres };
  }

  const api = { HOJAS, norm, rutClean, rutFormat, celda, leerHoja, leerLibro, serialToIso };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else global.Hojas = api;
})(typeof window !== 'undefined' ? window : globalThis);
