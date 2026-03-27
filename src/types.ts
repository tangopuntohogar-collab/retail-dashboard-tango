/** Fila que retorna la vista Dashboard_Ventas_Local (columnas reales SQL Server) */
export interface VentaRow {
  // ── Columnas reales de la vista SQL ──────────────────────────────────
  fecha: string;                    // Fecha
  nro_sucursal: string;             // Nro. Sucursal
  t_comp: string;                   // Tipo de comprobante
  n_comp: string;                   // Nro. Comprobante
  cod_vendedor: string;             // Cód. vendedor
  cod_articu: string;               // Cód. Artículo
  descripcio: string;               // Descripción
  descripcion_adicional?: string;
  medioPago: string | null;         // Medio de Pago  ← NUEVO
  precioNeto: number | null;        // Precio Neto    ← NUEVO
  precioUnitario: number | null;    // Precio Unitario ← NUEVO
  totalIVA: number | null;          // Total cIVA     ← NUEVO
  familia: string | null;           // Familia
  categoria: string | null;         // Categoria
  cantidad: number;                 // Cantidad

  // ── Aliases y campos derivados (backwards compat con SalesTable/Header) ──
  /** @alias totalIVA — importe proporcional c/IVA (fuente de verdad de facturación) */
  imp_prop_c_iva: number | null;
  /** @alias totalIVA */
  importe_c_iva: number;
  /** @alias precioNeto */
  precio_neto: number | null;
  /** @alias precioUnitario */
  pr_ult_cpa_c_iva: number | null;

  // ── Campos opcionales (no en esta vista, pueden venir de otras fuentes) ──
  cod_client?: string;
  razon_social?: string;
  cod_cond_venta?: string;
  desc_cond_venta?: string;
  costo?: number | null;
  margen_contribucion?: number;
  desc_adic?: string | null;
  rubro?: string;
  monto_comprobante?: number;
  cod_cta?: string;
  desc_cuenta?: string;
  cant_cuotas?: number | null;
  modalida_venta?: string;
  /** null en Notas de Crédito (no aplica rentabilidad) */
  porcentaje_rentabilidad?: number | null;
  tipo?: string | null;
  genero?: string | null;
  proveedor?: string | null;
}

export interface StockStat {
  totalVendido: number;
}

/** Fila para la vista de Análisis de Stock */
export interface StockRow {
  cod_art: string;
  descripcion: string;
  descripcion_adicional?: string;
  nro_sucursal: number;
  sucursal: string;
  cod_deposito: string;
  deposito: string;
  um_stock: string;
  saldo: number;
  familia: string;
  categoria: string;
  tipo_art: string;
  genero: string;
  proveedor: string;
  costo_unit: number;
  fecha_ult_compra?: string;
  // Estadísticas (Dynamic from SQL)
  totalVendido?: number;
  totalVendidoGral?: number;
}

export interface StockMatrixRow {
  cod_art: string;
  descripcion: string;
  descripcion_adicional?: string;
  familia: string;
  categoria: string;
  tipo_art: string;
  genero: string;
  proveedor: string;
  costo_unit: number;
  fecha_ult_compra?: string;
  sucursales: { [nro_sucursal: string]: number };
  stock_total: number;
  stats: { [nro_sucursal: string]: StockStat };
}

/** Filtros unificados para todas las vistas (Dashboard y Detalle) */
export interface VentasFilters {
  fechaDesde: string;         // 'YYYY-MM-DD'
  fechaHasta: string;         // 'YYYY-MM-DD'
  sucursales: string[];        // nro_sucursal
  rubros: string[];
  modalidades: string[];       // modalida_venta
  mediosPago: string[];        // medioPago (campo real de SQL)
  search: string;              // ilike en descripcio o cod_articu
  cuentas: string[];           // desc_cuenta (legacy)
  clientes: string[];          // legacy / UI opcional (nombres)
  /** Código de cliente (CTA02) — filtro exacto en servidor; vacío = sin filtro */
  cliente: string;
  cuotas: number[];            // cant_cuotas seleccionadas
  comprobante: string;         // ilike en n_comp
  familias: string[];
  categorias: string[];
  tipos: string[];
  generos: string[];
  proveedores: string[];
  periodoAnalisis: '12m' | '6m' | '3m' | '1m' | '30d';
}

/** Fila del Detalle de Efectivo por Sucursal (saldos de tesorería) */
export interface SaldoCajaRow {
  nro_sucursal: string;
  cod_cuenta: string;
  desc_cuenta: string;
  saldo: number;
  fecha_actualizacion: string;
}

export interface StockFilters {
  fechaDesde: string;
  fechaHasta: string;
  sucursales: string[];
  search: string;
  familias: string[];
  categorias: string[];
  tipos: string[];
  generos: string[];
  proveedores: string[];
}

export const getInitialStockFilters = (): StockFilters => {
  const today = new Date();
  const thirtyDaysAgo = new Date(today);
  thirtyDaysAgo.setDate(today.getDate() - 30);
  
  const toISO = (d: Date) => {
    const offset = d.getTimezoneOffset();
    const localDate = new Date(d.getTime() - (offset * 60 * 1000));
    return localDate.toISOString().substring(0, 10);
  };

  return {
    fechaDesde: toISO(thirtyDaysAgo),
    fechaHasta: toISO(today),
    sucursales: [],
    search: '',
    familias: [],
    categorias: [],
    tipos: [],
    generos: [],
    proveedores: [],
  };
};

/** Helper para obtener los filtros iniciales (mes en curso) */
export const getInitialFilters = (): VentasFilters => {
  const today = new Date();
  const firstOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
  const toISO = (d: Date) => {
    // Offset local para evitar cambios de día por zona horaria
    const offset = d.getTimezoneOffset();
    const localDate = new Date(d.getTime() - (offset * 60 * 1000));
    return localDate.toISOString().substring(0, 10);
  };

  return {
    fechaDesde: toISO(firstOfMonth),
    fechaHasta: toISO(today),
    sucursales: [],
    rubros: [],
    modalidades: [],
    mediosPago: [],
    search: '',
    cuentas: [],
    clientes: [],
    cliente: '',
    cuotas: [],
    comprobante: '',
    familias: [],
    categorias: [],
    tipos: [],
    generos: [],
    proveedores: [],
    periodoAnalisis: '3m',
  };
};

/** Alias para compatibilidad parcial (se irán eliminando) */
export type Filters = VentasFilters;
export type DetailFilters = VentasFilters;

/** Opciones disponibles para los checkboxes de los sidebars de filtros */
export interface DetailFilterOptions {
  sucursales: string[];
  rubros: string[];
  mediosPago: string[];   // valores únicos de medioPago (columna SQL 'Medio de Pago')
  cuentas: string[];      // legacy
  clientes: string[];
  cuotas: number[];
  familias: string[];
  categorias: string[];
  tipos: string[];
  generos: string[];
  proveedores: string[];
}

export interface DashboardStats {
  totalFacturado: number;
  margenTotal: number;
  rentabilidad: number;
  ticketPromedio: number;
}

export interface BranchSales {
  name: string;
  amount: number;
  percentage: number;
}

export interface PaymentMix {
  key: string;
  label: string;
  color: string;
  amount: number;
  pct: number;
}

export interface RubroPoint {
  rubro: string;
  avg_margen: number;
  total_cantidad: number;
}

export interface DashboardKPIs {
  totalFacturado: number;
  margenTotal: number;
  rentabilidad: number;
  voucherCount: number;
}

export interface StackedDataPoint {
  nro_sucursal: string;
  categoria_negocio: string;
  medio_pago: string;
  monto: number;
}

/** Fila para Resumen de Cobros: monto por sucursal y medio de pago */
export interface CobroPorMedioSucursal {
  nro_sucursal: string;
  medio_pago: string;
  monto: number;
}

export interface TopArticle {
  cod_articu: string;
  descripcio: string;
  total: number;
  cant: number;
  margen: number;
}

export interface DashboardMetrics {
  kpis: DashboardKPIs;
  /** KPIs del período anterior (mismo largo en días); solo si el API se pidió con incluirPeriodoAnterior=1 */
  kpisAnt?: DashboardKPIs;
  stacked_data: StackedDataPoint[];
  cobros_por_medio_sucursal?: CobroPorMedioSucursal[];
  top_articles: TopArticle[];
  rubro_points: RubroPoint[];
  rows_count?: number;
}
