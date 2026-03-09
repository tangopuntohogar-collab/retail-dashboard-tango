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
  porcentaje_rentabilidad?: number;
  tipo?: string | null;
  genero?: string | null;
  proveedor?: string | null;
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
  clientes: string[];          // razon_social
  cuotas: number[];            // cant_cuotas seleccionadas
  comprobante: string;         // ilike en n_comp
  familias: string[];
  categorias: string[];
  tipos: string[];
  generos: string[];
  proveedores: string[];
}

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
    cuotas: [],
    comprobante: '',
    familias: [],
    categorias: [],
    tipos: [],
    generos: [],
    proveedores: [],
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

export interface TopArticle {
  cod_articu: string;
  descripcio: string;
  total: number;
  cant: number;
  margen: number;
}

export interface DashboardMetrics {
  kpis: DashboardKPIs;
  stacked_data: StackedDataPoint[];
  top_articles: TopArticle[];
  rubro_points: RubroPoint[];
  rows_count?: number;
}
