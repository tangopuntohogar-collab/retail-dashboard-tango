import type {
  VentaRow,
  DashboardMetrics,
  SaldoCajaRow,
  StockMatrixRow,
  StockFilters,
  VentasFilters,
} from '../types';
import { isNotaCreditoTipo } from './salesService';

const CATEGORIAS_COBRO = ['EFECTIVO', 'TRANSFERENCIAS', 'TARJETA', 'CTA_CTE', 'CREDITO POR FINANCIERA'] as const;

function getCategoriaCobro(item: VentaRow): string {
  const medio = String(item.medioPago ?? '').toUpperCase();
  if (medio === 'CREDITO POR FINANCIERA' || (medio.includes('CREDITO') && medio.includes('FINANCIERA')))
    return 'CREDITO POR FINANCIERA';
  if (medio.startsWith('CAJA')) return 'EFECTIVO';
  if (medio.startsWith('BANCO')) return 'TRANSFERENCIAS';
  if (
    medio.includes('CREDITO EMPLEADO') ||
    medio.includes('CTA. CTE.') ||
    medio.includes('CUENTA CORRIENTE')
  )
    return 'CTA_CTE';
  return 'TARJETA';
}

function impVenta(r: VentaRow): number {
  return Number(r.totalIVA ?? r.imp_prop_c_iva ?? r.importe_c_iva ?? 0);
}

export interface DashboardAggregatePayload {
  screen: 'dashboard';
  periodo: { desde: string; hasta: string };
  kpis: { totalFacturado: number; ticketPromedio: number };
  ventasPorSucursal: Array<{
    sucursal: string;
    actual: number;
    anterior: number;
    variacionPct: number;
  }>;
  cobrosPivot: {
    porCategoria: Record<string, number>;
    porSucursal: Record<string, Record<string, number>>;
  };
  saldosTesoreria: Array<{ sucursal: string; cuenta: string; saldo: number }>;
}

export function aggregateDashboardMetrics(
  dashboardData: DashboardMetrics | null,
  cobrosVentas: VentaRow[],
  ventasAnterior: VentaRow[],
  saldosCajas: SaldoCajaRow[],
  filters: { fechaDesde: string; fechaHasta: string }
): DashboardAggregatePayload {
  const totalFacturado = dashboardData?.kpis.totalFacturado ?? 0;
  const voucherCount = dashboardData?.kpis.voucherCount ?? 0;
  const ticketPromedio = voucherCount > 0 ? totalFacturado / voucherCount : 0;

  const colActual = new Map<string, number>();
  cobrosVentas.forEach((item) => {
    const suc = String(item.nro_sucursal ?? '').trim();
    if (!suc) return;
    colActual.set(suc, (colActual.get(suc) ?? 0) + impVenta(item));
  });

  const colAnterior = new Map<string, number>();
  ventasAnterior.forEach((item) => {
    const suc = String(item.nro_sucursal ?? '').trim();
    if (!suc) return;
    colAnterior.set(suc, (colAnterior.get(suc) ?? 0) + impVenta(item));
  });

  const allSucs = Array.from(new Set([...colActual.keys(), ...colAnterior.keys()])).sort((a, b) => {
    const na = parseInt(a, 10);
    const nb = parseInt(b, 10);
    if (!Number.isNaN(na) && !Number.isNaN(nb)) return na - nb;
    return String(a).localeCompare(String(b));
  });

  const ventasPorSucursal = allSucs.map((suc) => {
    const actual = colActual.get(suc) ?? 0;
    const anterior = colAnterior.get(suc) ?? 0;
    const variacionPct =
      anterior > 0 ? ((actual - anterior) / anterior) * 100 : actual > 0 ? 100 : 0;
    return { sucursal: suc, actual, anterior, variacionPct };
  });

  const matrix = new Map<string, Map<string, number>>();
  cobrosVentas.forEach((item) => {
    const cat = getCategoriaCobro(item);
    const suc = String(item.nro_sucursal ?? '');
    const monto = impVenta(item);
    if (!matrix.has(cat)) matrix.set(cat, new Map());
    const row = matrix.get(cat)!;
    row.set(suc, (row.get(suc) ?? 0) + monto);
  });

  const porCategoria: Record<string, number> = {};
  CATEGORIAS_COBRO.forEach((c) => {
    if (!matrix.has(c)) return;
    let sum = 0;
    matrix.get(c)!.forEach((v) => (sum += v));
    porCategoria[c] = sum;
  });

  const porSucursal: Record<string, Record<string, number>> = {};
  allSucs.forEach((suc) => {
    porSucursal[suc] = {};
    CATEGORIAS_COBRO.forEach((cat) => {
      const v = matrix.get(cat)?.get(suc) ?? 0;
      if (v > 0) porSucursal[suc][cat] = v;
    });
  });

  const saldosTesoreria = saldosCajas.map((s) => ({
    sucursal: String(s.nro_sucursal),
    cuenta: s.desc_cuenta,
    saldo: Number(s.saldo ?? 0),
  }));

  return {
    screen: 'dashboard',
    periodo: { desde: filters.fechaDesde, hasta: filters.fechaHasta },
    kpis: { totalFacturado, ticketPromedio },
    ventasPorSucursal,
    cobrosPivot: { porCategoria, porSucursal },
    saldosTesoreria,
  };
}

export interface DetailAggregatePayload {
  screen: 'detail';
  periodo: { desde: string; hasta: string };
  resumen: {
    totalRegistros: number;
    totalImporte: number;
    sucursalesActivas: number;
    mediosPagoTop5: Array<{ medio: string; monto: number; pct: number }>;
    familiasTop5: Array<{ familia: string; monto: number; pct: number }>;
  };
  alertasRentabilidad: {
    negativas: number;
    bajoUmbral: number;
    articulosSinCosto: number;
    peoresArticulos: Array<{ descripcion: string; rentabilidad: number; monto: number }>;
  };
  distribucionPorSucursal: Array<{ sucursal: string; monto: number; pct: number }>;
}

function rentabilidadPct(row: VentaRow): number | null {
  if (isNotaCreditoTipo(row.t_comp)) return null;
  return row.porcentaje_rentabilidad ?? 0;
}

export function aggregateDetailMetrics(
  ventasRows: VentaRow[],
  filters: VentasFilters,
  options: { totalRegistros: number; totalImporte: number },
  umbrales: { rentabilidadMinPct: number }
): DetailAggregatePayload {
  const totalImporte = options.totalImporte;
  const medioMap = new Map<string, number>();
  const familiaMap = new Map<string, number>();
  const sucMap = new Map<string, number>();

  let negativas = 0;
  let bajoUmbral = 0;
  let articulosSinCosto = 0;
  const peoresPool: Array<{ descripcion: string; rentabilidad: number; monto: number }> = [];

  ventasRows.forEach((r) => {
    const imp = impVenta(r);
    const mp = r.medioPago ?? '(sin medio)';
    medioMap.set(mp, (medioMap.get(mp) ?? 0) + imp);
    const fam = r.familia ?? '(sin familia)';
    familiaMap.set(fam, (familiaMap.get(fam) ?? 0) + imp);
    const suc = String(r.nro_sucursal ?? '');
    sucMap.set(suc, (sucMap.get(suc) ?? 0) + imp);

    const costo = r.costo;
    const rent = rentabilidadPct(r);
    if (costo == null || costo <= 0) articulosSinCosto += 1;
    if (rent !== null) {
      if (rent < 0) negativas += 1;
      if (rent < umbrales.rentabilidadMinPct && (costo ?? 0) > 0) bajoUmbral += 1;
      peoresPool.push({
        descripcion: r.descripcio ?? r.cod_articu ?? '-',
        rentabilidad: rent,
        monto: imp,
      });
    }
  });

  const mediosSorted = [...medioMap.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
  const mediosPagoTop5 = mediosSorted.map(([medio, monto]) => ({
    medio,
    monto,
    pct: totalImporte > 0 ? (monto / totalImporte) * 100 : 0,
  }));

  const famSorted = [...familiaMap.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
  const familiasTop5 = famSorted.map(([familia, monto]) => ({
    familia,
    monto,
    pct: totalImporte > 0 ? (monto / totalImporte) * 100 : 0,
  }));

  const sucSorted = [...sucMap.entries()].sort((a, b) => b[1] - a[1]);
  const distribucionPorSucursal = sucSorted.map(([sucursal, monto]) => ({
    sucursal,
    monto,
    pct: totalImporte > 0 ? (monto / totalImporte) * 100 : 0,
  }));

  peoresPool.sort((a, b) => a.rentabilidad - b.rentabilidad);
  const peoresArticulos = peoresPool.slice(0, 10);

  const sucursalesActivas = new Set(ventasRows.map((r) => String(r.nro_sucursal))).size;

  return {
    screen: 'detail',
    periodo: { desde: filters.fechaDesde, hasta: filters.fechaHasta },
    resumen: {
      totalRegistros: options.totalRegistros,
      totalImporte,
      sucursalesActivas,
      mediosPagoTop5,
      familiasTop5,
    },
    alertasRentabilidad: {
      negativas,
      bajoUmbral,
      articulosSinCosto,
      peoresArticulos,
    },
    distribucionPorSucursal,
  };
}

export interface StockAggregatePayload {
  screen: 'stock';
  periodo: { desde: string; hasta: string };
  resumen: {
    articulosConStock: number;
    articulosBajaCobertura: number;
    articulosSinVentasConStock: number;
    articulosAltaCobertura: number;
  };
  topBajaCobertura: Array<{
    cod_art: string;
    descripcion: string;
    stock: number;
    ventasPeriodo: number;
    coberturaDias: number;
  }>;
  topSinVentasConStock: Array<{ cod_art: string; descripcion: string; stock: number }>;
  topSobrestock: Array<{
    cod_art: string;
    descripcion: string;
    stock: number;
    coberturaDias: number;
  }>;
  desequilibrioSucursales: Array<{
    cod_art: string;
    descripcion: string;
    sucursalSinStock: string;
    sucursalConStock: string;
    stockDisponible: number;
  }>;
}

export function aggregateStockMetrics(
  stockRows: StockMatrixRow[],
  filters: StockFilters,
  umbrales: { coberturaCriticaDias: number; coberturaAltaDias: number },
  statsSucursal: string
): StockAggregatePayload {
  const fechaDesde = filters.fechaDesde;
  const fechaHasta = filters.fechaHasta;
  const daysInRange = Math.max(
    1,
    Math.round(
      (new Date(fechaHasta).getTime() - new Date(fechaDesde).getTime()) / (1000 * 60 * 60 * 24)
    ) + 1
  );

  let articulosBajaCobertura = 0;
  let articulosSinVentasConStock = 0;
  let articulosAltaCobertura = 0;

  const bajaCob: StockAggregatePayload['topBajaCobertura'] = [];
  const sinVentas: StockAggregatePayload['topSinVentasConStock'] = [];
  const sobre: StockAggregatePayload['topSobrestock'] = [];

  stockRows.forEach((item) => {
    const totalVendido =
      item.stats[statsSucursal]?.totalVendido ?? item.stats['1001']?.totalVendido ?? 0;
    const ventaDiaria = totalVendido / daysInRange;
    let coberturaDias: number | null = null;
    if (ventaDiaria > 0) {
      coberturaDias = Math.round(item.stock_total / ventaDiaria);
    }

    if (item.stock_total > 0 && totalVendido === 0) {
      articulosSinVentasConStock += 1;
      sinVentas.push({
        cod_art: item.cod_art,
        descripcion: item.descripcion,
        stock: item.stock_total,
      });
    }

    if (coberturaDias !== null) {
      if (coberturaDias < umbrales.coberturaCriticaDias && ventaDiaria > 0) {
        articulosBajaCobertura += 1;
        bajaCob.push({
          cod_art: item.cod_art,
          descripcion: item.descripcion,
          stock: item.stock_total,
          ventasPeriodo: totalVendido,
          coberturaDias,
        });
      }
      if (coberturaDias > umbrales.coberturaAltaDias) {
        articulosAltaCobertura += 1;
        sobre.push({
          cod_art: item.cod_art,
          descripcion: item.descripcion,
          stock: item.stock_total,
          coberturaDias,
        });
      }
    }
  });

  bajaCob.sort((a, b) => a.coberturaDias - b.coberturaDias);
  sinVentas.sort((a, b) => b.stock - a.stock);
  sobre.sort((a, b) => b.coberturaDias - a.coberturaDias);

  const desequilibrioSucursales: StockAggregatePayload['desequilibrioSucursales'] = [];
  stockRows.forEach((item) => {
    const entries = Object.entries(item.sucursales);
    if (entries.length < 2) return;
    const minEntry = entries.reduce((a, b) => (a[1] <= b[1] ? a : b));
    const maxEntry = entries.reduce((a, b) => (a[1] >= b[1] ? a : b));
    if (minEntry[1] === 0 && maxEntry[1] > 0) {
      desequilibrioSucursales.push({
        cod_art: item.cod_art,
        descripcion: item.descripcion,
        sucursalSinStock: minEntry[0],
        sucursalConStock: maxEntry[0],
        stockDisponible: maxEntry[1],
      });
    }
  });
  desequilibrioSucursales.sort((a, b) => b.stockDisponible - a.stockDisponible);

  return {
    screen: 'stock',
    periodo: { desde: fechaDesde, hasta: fechaHasta },
    resumen: {
      articulosConStock: stockRows.length,
      articulosBajaCobertura,
      articulosSinVentasConStock,
      articulosAltaCobertura,
    },
    topBajaCobertura: bajaCob.slice(0, 10),
    topSinVentasConStock: sinVentas.slice(0, 10),
    topSobrestock: sobre.slice(0, 10),
    desequilibrioSucursales: desequilibrioSucursales.slice(0, 10),
  };
}
