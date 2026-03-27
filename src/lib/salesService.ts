import { VentaRow, VentasFilters, DashboardMetrics, DashboardKPIs, StackedDataPoint, TopArticle, RubroPoint, SaldoCajaRow } from '../types';
import { getServerBaseUrl } from './apiConfig';

const apiRoot = () => `${getServerBaseUrl()}/api`;
console.log('[Network] API Base URL:', apiRoot());

/** Límite de filas para el detalle de grilla (Frontend) */
export const PAGE_SIZE = 500;

/** Query params alineados con `buildWhere` / `ventasFilterPayloadFromQuery` en server.ts */
export function appendVentasSqlFilters(params: URLSearchParams, filters: VentasFilters) {
    if (filters.fechaDesde) params.set('desde', filters.fechaDesde);
    if (filters.fechaHasta) params.set('hasta', filters.fechaHasta);
    if (filters.mediosPago?.length === 1) params.set('medioPago', filters.mediosPago[0]);
    if (filters.familias?.length === 1) params.set('familia', filters.familias[0]);
    if (filters.categorias?.length === 1) params.set('categoria', filters.categorias[0]);
    filters.proveedores?.forEach(p => params.append('proveedor', String(p)));
    filters.sucursales?.forEach(s => params.append('sucursal', String(s)));
    filters.tipos?.forEach(t => params.append('tipo', String(t)));
    filters.generos?.forEach(g => params.append('genero', String(g)));
    if (filters.cliente?.trim()) params.set('cliente', filters.cliente.trim());
}

// Cache por rango de fechas: "desde|hasta" → VentaRow[]
const cache = new Map<string, VentaRow[]>();

/**
 * Función central de mapeo: de SQL Server (Dashboard_Ventas_Local) a VentaRow (Frontend).
 * Columnas reales de la vista: Fecha | Nro. Sucursal | Tipo de comprobante | Nro. Comprobante |
 * Cód. vendedor | Cód. Artículo | Descripción | Medio de Pago | Precio Neto |
 * Precio Unitario | Total cIVA | Familia | Categoria | Cantidad
 */
/** Nota de crédito (devolución): la rentabilidad no aplica — coincide con columna "Tipo de comprobante" de la vista. */
export function isNotaCreditoTipo(tipo: string | null | undefined): boolean {
    const u = String(tipo ?? '').trim().toUpperCase();
    if (!u) return false;
    return u === 'NC' || u.startsWith('NC');
}

/**
 * Función central de mapeo: de SQL Server (Dashboard_Ventas_Local) a VentaRow (Frontend).
 */
function mapVenta(row: any): VentaRow {
    const totalIVA   = Number(row['Total cIVA']      ?? 0);
    const precioNeto = row['Precio Neto']     != null ? Number(row['Precio Neto'])     : null;
    const precioUnit = row['Precio Unitario'] != null ? Number(row['Precio Unitario']) : null;
    const medioPago  = row['Medio de Pago']   ?? null;
    const proveedor  = row['PROVEEDOR (Adic.)'] ?? null; 
    const costoUnitario = row['CostoUnitario'] != null ? Number(row['CostoUnitario']) : null;
    const tipoComp = String(row['Tipo de comprobante'] ?? '').trim();

    let rentabilidad: number | null = null;
    if (!isNotaCreditoTipo(tipoComp)) {
        if (precioUnit != null && costoUnitario != null && costoUnitario > 0) {
            rentabilidad = ((precioUnit - costoUnitario) / costoUnitario) * 100;
        } else {
            rentabilidad = 0;
        }
    }

    const fechaRaw = row['Fecha'];
    const fecha = typeof fechaRaw === 'string'
        ? (fechaRaw.includes('T') ? fechaRaw.split('T')[0] : fechaRaw)
        : (fechaRaw ? String(fechaRaw).slice(0, 10) : '');

    return {
        // ── Columnas reales ──────────────────────────────────────────────────
        fecha,
        nro_sucursal:   String(row['Nro. Sucursal']   ?? ''),
        t_comp:         tipoComp,
        n_comp:         row['Nro. Comprobante']       ?? '',
        cod_vendedor:   row['Cód. vendedor']          ?? '',
        cod_articu:     row['Cód. Artículo']          ?? '',
        descripcio:     row['Descripción']            ?? '',
        medioPago,
        proveedor,      
        precioNeto,
        precioUnitario: precioUnit,
        totalIVA,
        familia:        row['Familia']                ?? null,
        categoria:      row['Categoria']              ?? null,
        cantidad:       Number(row['Cantidad']        ?? 0),

        // ── Aliases de compatibilidad ────────────────────────────────────────
        imp_prop_c_iva:    totalIVA,
        importe_c_iva:     totalIVA,
        precio_neto:       precioNeto,
        pr_ult_cpa_c_iva:  precioUnit,

        // ── Campos opcionales: no están en esta vista ────────────────────────
        rubro:                row['Familia'] ?? 'Otros',
        razon_social:         '',
        cod_cond_venta:       '',
        desc_cond_venta:      '',
        costo:                costoUnitario,
        margen_contribucion:  0,
        desc_adic:            null,
        monto_comprobante:    totalIVA,
        cod_cta:              '',
        desc_cuenta:          medioPago ?? '',
        descripcion_adicional: row['DescripcionAdicional'] ?? null,
        cant_cuotas:          null,
        modalida_venta:       'Contado/Tarjeta',
        porcentaje_rentabilidad: rentabilidad,
        tipo:                 row['TIPO (Adic.)'] ?? null,
        genero:               row['GENERO (Adic.)'] ?? null,
        cod_client:
            row['Cód. Cliente'] != null && String(row['Cód. Cliente']).trim() !== ''
                ? String(row['Cód. Cliente']).trim()
                : '',
    };
}

/**
 * Recupera ventas filtradas por fecha y las cachea por período.
 * Sigue usando el formato plano (sin paginación) para el cache interno del Dashboard.
 */
async function getAllVentas(desde?: string, hasta?: string): Promise<VentaRow[]> {
    const cacheKey = `${desde ?? ''}|${hasta ?? ''}`;
    if (cache.has(cacheKey)) return cache.get(cacheKey)!;

    try {
        // Limit=5000 para el cache del Dashboard — no se usa para la grilla
        const params = new URLSearchParams();
        if (desde) params.set('desde', desde);
        if (hasta) params.set('hasta', hasta);
        params.set('limit', '5000');
        params.set('page', '0');

        const url = `${apiRoot()}/ventas?${params}`;
        console.log('[salesService] Cache fill:', url);
        const response = await fetch(url);
        if (!response.ok) throw new Error(`HTTP Error ${response.status}`);

        const json = await response.json();
        const raw: any[] = Array.isArray(json) ? json : (json.data ?? []);
        console.log('Fila 0 desde Backend:', raw[0]);
        const rows = raw.map(mapVenta);
        cache.set(cacheKey, rows);
        return rows;
    } catch (err) {
        console.error('[salesService] Error fetching local data:', err);
        return [];
    }
}


/**
 * Lógica de filtrado en cliente (imita el comportamiento de Supabase)
 */
function applyFiltersLocal(data: VentaRow[], f: VentasFilters): VentaRow[] {
    return data.filter(row => {
        if (f.fechaDesde && row.fecha < f.fechaDesde) return false;
        if (f.fechaHasta && row.fecha > f.fechaHasta) return false;
        if (f.sucursales?.length && !f.sucursales.includes(row.nro_sucursal)) return false;
        if (f.rubros?.length && !f.rubros.includes(row.rubro ?? '')) return false;
        if (f.familias?.length && !f.familias.includes(row.familia || '')) return false;
        if (f.categorias?.length && !f.categorias.includes(row.categoria || '')) return false;

        // Filtro por Medio de Pago usando el campo real medioPago
        if (f.mediosPago?.length && !f.mediosPago.includes(row.medioPago ?? '')) return false;

        if (f.search?.trim()) {
            const s = f.search.toLowerCase();
            if (!row.descripcio.toLowerCase().includes(s) && !row.cod_articu.toLowerCase().includes(s)) return false;
        }
        if (f.comprobante?.trim()) {
            if (!row.n_comp.includes(f.comprobante.trim())) return false;
        }

        // Filtro por proveedor
        if (f.proveedores?.length && !f.proveedores.includes(row.proveedor ?? '')) return false;

        if (f.tipos?.length && !f.tipos.includes(row.tipo ?? '')) return false;
        if (f.generos?.length && !f.generos.includes(row.genero ?? '')) return false;
        if (f.cliente?.trim() && String(row.cod_client ?? '').trim() !== f.cliente.trim()) return false;

        return true;
    });
}

/**
 * Trae filas paginadas para la grilla — envía todos los filtros al servidor SQL.
 * Los filtros de texto libre (search, comprobante) se aplican en cliente.
 */
export async function fetchVentas(
    filters: VentasFilters,
    from = 0
): Promise<{ data: VentaRow[]; count: number; totalImporteGlobal: number }> {
    const pageIndex = Math.floor(from / PAGE_SIZE);

    const params = new URLSearchParams();
    appendVentasSqlFilters(params, filters);
    params.set('page', String(pageIndex));
    params.set('limit', String(PAGE_SIZE));

    try {
        const url = `${apiRoot()}/ventas?${params}`;
        console.log('[salesService] fetchVentas:', url);
        const response = await fetch(url);
        if (!response.ok) throw new Error(`HTTP Error ${response.status}`);

        const json = await response.json();
        let raw: any[] = Array.isArray(json) ? json : (json.data ?? []);
        const getPeriodo = (r: any) => (r?.periodo_comparativo ?? r?.periodo_Comparativo ?? 'actual').toString().toLowerCase();
        raw = raw.filter((r: any) => getPeriodo(r) === 'actual');
        console.log('Fila 0 desde Backend:', raw[0]);
        const total: number = json.total ?? raw.length;
        const totalImporteGlobal: number = Number(json.meta?.totalImporteGlobal ?? 0);

        let rows = raw.map(mapVenta);

        const serverFiltered = {
            ...filters,
            sucursales: [] as string[],
            mediosPago: filters.mediosPago?.length === 1 ? [] : filters.mediosPago,
            familias:   filters.familias?.length   === 1 ? [] : filters.familias,
            categorias: filters.categorias?.length === 1 ? [] : filters.categorias,
            proveedores: filters.proveedores,
            tipos: filters.tipos?.length ? [] as string[] : filters.tipos,
            generos: filters.generos?.length ? [] as string[] : filters.generos,
            cliente: filters.cliente?.trim() ? '' : filters.cliente,
        };
        rows = applyFiltersLocal(rows, serverFiltered as VentasFilters);

        return { data: rows, count: total, totalImporteGlobal };
    } catch (err) {
        console.error('[salesService] fetchVentas error, fallback cache:', err);
        const all = await getAllVentas(filters.fechaDesde, filters.fechaHasta);
        const filtered = applyFiltersLocal(all, filters);
        filtered.sort((a, b) => b.fecha.localeCompare(a.fecha));
        const totalImporteGlobal = filtered.reduce((acc, r) => acc + (r.totalIVA ?? 0), 0);
        return { data: filtered.slice(from, from + PAGE_SIZE), count: filtered.length, totalImporteGlobal };
    }
}

export interface VentasParaCobrosResult {
    actual: VentaRow[];
    anterior: VentaRow[];
}

/**
 * Trae ventas para la matriz de cobros y el gráfico comparativo.
 * Cuando hay desde/hasta, pide también el periodo anterior (mismo rango, mes previo).
 */
export async function fetchVentasParaCobros(filters: VentasFilters): Promise<VentasParaCobrosResult> {
    const params = new URLSearchParams();
    appendVentasSqlFilters(params, filters);
    params.set('page', '0');
    params.set('limit', '5000');
    if (filters.fechaDesde && filters.fechaHasta) params.set('incluirPeriodoAnterior', '1');

    try {
        const url = `${apiRoot()}/ventas?${params}`;
        const response = await fetch(url);
        if (!response.ok) throw new Error(`HTTP Error ${response.status}`);
        const json = await response.json();
        const raw: any[] = Array.isArray(json) ? json : (json.data ?? []);
        const getPeriodo = (r: any) => (r.periodo_comparativo ?? r.periodo_Comparativo ?? r.PERIODO_COMPARATIVO ?? 'actual').toString().toLowerCase();
        const rawActual = raw.filter((r: any) => getPeriodo(r) === 'actual');
        const rawAnterior = raw.filter((r: any) => getPeriodo(r) === 'anterior');
        console.log('[salesService] fetchVentasParaCobros - total:', raw.length, '| actual:', rawActual.length, '| anterior:', rawAnterior.length);
        console.log('[Debug] Data Mes Anterior:', rawAnterior);
        const serverFiltered = {
            ...filters,
            sucursales: [] as string[],
            mediosPago: filters.mediosPago?.length === 1 ? [] : filters.mediosPago,
            familias: filters.familias?.length === 1 ? [] : filters.familias,
            categorias: filters.categorias?.length === 1 ? [] : filters.categorias,
            proveedores: filters.proveedores,
            tipos: filters.tipos?.length ? [] as string[] : filters.tipos,
            generos: filters.generos?.length ? [] as string[] : filters.generos,
            cliente: filters.cliente?.trim() ? '' : filters.cliente,
        };
        
        const serverFilteredAnterior = {
            ...serverFiltered,
            fechaDesde: undefined,
            fechaHasta: undefined,
        }

        let actual = rawActual.map(mapVenta);
        let anterior = rawAnterior.map(mapVenta);
        actual = applyFiltersLocal(actual, serverFiltered as VentasFilters);
        anterior = applyFiltersLocal(anterior, serverFilteredAnterior as VentasFilters);
        return { actual, anterior };
    } catch (err) {
        console.error('[salesService] fetchVentasParaCobros error, fallback getAllVentas:', err);
        const all = await getAllVentas(filters.fechaDesde, filters.fechaHasta);
        const filtered = applyFiltersLocal(all, filters);
        return { actual: filtered, anterior: [] };
    }
}

/**
 * Saldos de cajas (tesorería) por sucursal — último registro por sucursal/cuenta.
 */
export async function fetchSaldosCajas(): Promise<SaldoCajaRow[]> {
    try {
        const url = `${apiRoot()}/saldos-cajas`;
        const response = await fetch(url);
        if (!response.ok) throw new Error(`HTTP Error ${response.status}`);
        const raw: any[] = await response.json();
        return raw.map((r: any) => ({
            nro_sucursal: String(r['NRO. SUCURSAL'] ?? r.NRO_SUCURSAL ?? ''),
            cod_cuenta: String(r['COD. CUENTA'] ?? r.COD_CTA_CUENTA_TESORERIA ?? ''),
            desc_cuenta: String(r['DESC. CUENTA'] ?? r.DESC_CTA_CUENTA_TESORERIA ?? ''),
            saldo: Number(r.SALDO ?? r.SALDO_CORRIENTE ?? 0),
            fecha_actualizacion: r['FECHA_ACTUALIZACION'] ?? r.FECHA_IMPORTACION ?? '',
        }));
    } catch (err) {
        console.error('[salesService] fetchSaldosCajas error:', err);
        return [];
    }
}

/**
 * Totales agregados para gráficos — usa /api/ventas/stats.
 * Evita descargar el detalle completo solo para calcular KPIs.
 */
export async function fetchVentasStats(filters: VentasFilters): Promise<{
    totalFacturado: number;
    cantidadTotal: number;
    filasTotales: number;
    voucherCount: number;
    sucursales: number;
    fechaMin: string | null;
    fechaMax: string | null;
}> {
    const params = new URLSearchParams();
    appendVentasSqlFilters(params, filters);

    const url = `${apiRoot()}/ventas/stats?${params}`;
    console.log('[salesService] fetchVentasStats:', url);
    const response = await fetch(url);
    if (!response.ok) throw new Error(`HTTP Error ${response.status}`);
    return response.json();
}


/**
 * Dashboard: Usa el endpoint /api/dashboard que agrega en SQL Server.
 * Ahora pasa todos los filtros activos para que el WHERE sea correcto.
 */
export async function fetchVentasAgregadas(filters: VentasFilters): Promise<DashboardMetrics> {
    try {
        const params = new URLSearchParams();
        appendVentasSqlFilters(params, filters);

        console.log('[Debug] Filtros enviados a /api/dashboard:', Array.from(params.entries()));

        const url = `${apiRoot()}/dashboard?${params}`;
        console.log('[salesService] Dashboard fetch:', url);
        const response = await fetch(url);
        if (!response.ok) throw new Error(`HTTP Error ${response.status}`);
        const data: DashboardMetrics = await response.json();

        // Filtros multi-valor que el servidor no maneja: aplica en cliente sobre stacked_data
        if (filters.sucursales?.length) {
            data.stacked_data = data.stacked_data.filter(d =>
                filters.sucursales!.includes(d.nro_sucursal)
            );
        }

        return data;
    } catch (err) {
        console.error('[salesService] fetchVentasAgregadas error (fallback local):', err);
        const all = await getAllVentas(filters.fechaDesde, filters.fechaHasta);
        const filtered = applyFiltersLocal(all, filters);

        // Helper: usa totalIVA (ya negativo para NC en SQL) como métrica principal
        const getImporte = (r: VentaRow) => r.totalIVA ?? r.imp_prop_c_iva ?? 0;

        const totalFacturado = filtered.reduce((acc, r) => acc + getImporte(r), 0);
        const margenTotal = filtered.reduce((acc, r) => {
            if (isNotaCreditoTipo(r.t_comp)) return acc;
            const c = r.costo;
            if (c == null || c <= 0) return acc;
            const pn = r.precioNeto ?? r.precio_neto ?? 0;
            return acc + (pn - c * (r.cantidad ?? 0));
        }, 0);
        const rentabilidad = totalFacturado !== 0 ? (margenTotal / totalFacturado) * 100 : 0;

        const kpis: DashboardKPIs = {
            // SUM(totalIVA) — las Notas de Crédito restan porque totalIVA ya es negativo
            totalFacturado,
            margenTotal,
            rentabilidad,
            voucherCount: new Set(filtered.map(r => r.n_comp)).size
        };

        // Stacked por sucursal: acumula totalIVA (positivo ↑ para FAC, negativo ↓ para NC)
        const stackedMap = new Map<string, number>();
        filtered.forEach(r => {
            const mp = r.medioPago ?? 'Efectivo';
            const key = `${r.nro_sucursal}|Venta|${mp}`;
            stackedMap.set(key, (stackedMap.get(key) ?? 0) + getImporte(r));
        });
        const stacked_data: StackedDataPoint[] = Array.from(stackedMap.entries()).map(([key, monto]) => {
            const [suc, cat, med] = key.split('|');
            return { nro_sucursal: suc, categoria_negocio: cat, medio_pago: med, monto };
        });

        const cobros_por_medio_sucursal = stacked_data.map(d => ({
            nro_sucursal: d.nro_sucursal,
            medio_pago: d.medio_pago,
            monto: d.monto,
        }));

        // Top artículos por totalIVA neto (descuentos de NC ya restados)
        const articleMap = new Map<string, { desc: string, total: number, cant: number }>();
        filtered.forEach(r => {
            const entry = articleMap.get(r.cod_articu) || { desc: r.descripcio, total: 0, cant: 0 };
            entry.total += getImporte(r);
            entry.cant += r.cantidad ?? 0;
            articleMap.set(r.cod_articu, entry);
        });
        const top_articles: TopArticle[] = Array.from(articleMap.entries())
            .map(([cod, info]) => ({ cod_articu: cod, descripcio: info.desc, total: info.total, cant: info.cant, margen: 0 }))
            .sort((a, b) => b.total - a.total).slice(0, 10);

        const rubroMap = new Map<string, { cant: number }>();
        filtered.forEach(r => {
            const entry = rubroMap.get(r.rubro ?? 'Otros') || { cant: 0 };
            entry.cant += r.cantidad ?? 0;
            rubroMap.set(r.rubro ?? 'Otros', entry);
        });
        const rubro_points: RubroPoint[] = Array.from(rubroMap.entries()).map(([rubro, info]) => ({
            rubro, avg_margen: 0, total_cantidad: info.cant
        }));
        return { kpis, stacked_data, cobros_por_medio_sucursal, top_articles, rubro_points };
    }
}

export async function fetchVentasAgregadasPrevio(filters: VentasFilters): Promise<DashboardMetrics> {
    const shiftMonth = (iso: string, delta: number): string => {
        const d = new Date(`${iso}T00:00:00`);
        d.setMonth(d.getMonth() + delta);
        return d.toISOString().substring(0, 10);
    };
    const prevFilters: VentasFilters = {
        ...filters,
        fechaDesde: shiftMonth(filters.fechaDesde, -1),
        fechaHasta: shiftMonth(filters.fechaHasta, -1),
    };
    return fetchVentasAgregadas(prevFilters);
}

/**
 * Helpers para Sidebars (Filtros únicos)
 */
export interface DateRange { fechaDesde: string; fechaHasta: string; }

export async function fetchSucursales(range: DateRange): Promise<string[]> {
    const all = await getAllVentas(range.fechaDesde, range.fechaHasta);
    return Array.from(new Set(all.map(r => r.nro_sucursal))).sort();
}

export async function fetchRubros(range: DateRange): Promise<string[]> {
    const all = await getAllVentas(range.fechaDesde, range.fechaHasta);
    return Array.from(new Set(all.map(r => r.rubro).filter((v): v is string => Boolean(v)))).sort();
}

/**
 * Extrae los Medios de Pago únicos del período desde el campo real `medioPago`
 * (mapeado desde la columna SQL 'Medio de Pago'). Ignora nulos y vacíos.
 */
/**
 * Carga todas las opciones de filtros de una sola llamada al endpoint /api/ventas/options.
 * Mucho más eficiente que descargar filas: usa solo queries DISTINCT en SQL.
 */
export async function fetchFilterOptions(range: DateRange): Promise<{
    mediosPago: string[];
    familias: string[];
    categorias: string[];
    sucursales: string[];
    tipos: string[];
    generos: string[];
    clientes: string[];
}> {
    const params = new URLSearchParams();
    if (range.fechaDesde) params.set('desde', range.fechaDesde);
    if (range.fechaHasta) params.set('hasta', range.fechaHasta);
    const url = `${apiRoot()}/ventas/options?${params}`;
    console.log('[salesService] fetchFilterOptions:', url);
    const response = await fetch(url);
    if (!response.ok) throw new Error(`HTTP Error ${response.status}`);
    const j = await response.json();
    return {
        mediosPago: j.mediosPago ?? [],
        familias: j.familias ?? [],
        categorias: j.categorias ?? [],
        sucursales: j.sucursales ?? [],
        tipos: j.tipos ?? [],
        generos: j.generos ?? [],
        clientes: j.clientes ?? [],
    };
}

export async function fetchMediosPago(range: DateRange): Promise<string[]> {
    const opts = await fetchFilterOptions(range);
    return opts.mediosPago;
}

/**
 * Lee el cache ya cargado en memoria y devuelve los médios de pago únicos.
 * Síncrono → apto para useMemo(). Devuelve [] si el período no está cacheado aún.
 */
export function getMediosPagoFromCache(fechaDesde: string, fechaHasta: string): string[] {
    const cacheKey = `${fechaDesde}|${fechaHasta}`;
    const cached = cache.get(cacheKey);
    if (!cached) return [];
    return Array.from(
        new Set(
            cached
                .map(r => r.medioPago)
                .filter((v): v is string => Boolean(v && v.trim()))
        )
    ).sort();
}

export async function fetchTopClientes(range: DateRange): Promise<string[]> {
    const all = await getAllVentas(range.fechaDesde, range.fechaHasta);
    return Array.from(new Set(all.map(r => r.razon_social))).slice(0, 50).sort();
}

export async function fetchCuotas(range: DateRange): Promise<number[]> {
    return [0, 1, 3, 6, 12];
}

export const fetchFamilias = fetchRubros;
export const fetchCategorias = (range: DateRange) => Promise.resolve(['General']);
export async function fetchProveedores(filters: VentasFilters): Promise<string[]> {
    const all = await getAllVentas(filters.fechaDesde, filters.fechaHasta);
    const tempFilters = { ...filters, proveedores: [] }; // Ignoramos el filtro de proveedor actual para no vaciar la lista
    const filtered = applyFiltersLocal(all, tempFilters);
    return Array.from(new Set(
        filtered.map(r => r.proveedor)
           .filter((v): v is string => Boolean(v && v.trim() && v !== '-'))
    )).sort();
}

/** @deprecated Usá fetchMediosPago en su lugar */
export const fetchDescCuentas = fetchMediosPago;
