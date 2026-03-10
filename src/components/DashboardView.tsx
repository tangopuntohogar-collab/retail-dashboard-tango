import React, { useMemo, useState } from 'react';
import { StatsCard } from './StatsCard';
import { PaymentMix, DashboardMetrics, VentaRow } from '../types';
import { Loader2 } from 'lucide-react';

/** Categoriza el medio de pago para el Resumen de Cobros (mismo mapeo que Detalle) */
const getCategoriaCobro = (item: VentaRow): string => {
  const medio = String(item.medioPago ?? '').toUpperCase();
  if (medio === 'CREDITO POR FINANCIERA' || (medio.includes('CREDITO') && medio.includes('FINANCIERA'))) return 'CREDITO POR FINANCIERA';
  if (medio.startsWith('CAJA')) return 'EFECTIVO';
  if (medio.startsWith('BANCO')) return 'TRANSFERENCIAS';
  if (medio.includes('CREDITO EMPLEADO') || medio.includes('CTA. CTE.') || medio.includes('CUENTA CORRIENTE')) return 'CTA_CTE';
  return 'TARJETA';
};

/** Orden fijo de categorías para la tabla */
const CATEGORIAS_COBRO = ['EFECTIVO', 'TRANSFERENCIAS', 'TARJETA', 'CTA_CTE', 'CREDITO POR FINANCIERA'] as const;

/** Colores por categoría para el gráfico de barras (sincronizado con Resumen de Cobros) */
const COLORES_COBRO: Record<string, string> = {
  EFECTIVO: '#10b981',
  TRANSFERENCIAS: '#3b82f6',
  TARJETA: '#f59e0b',
  CTA_CTE: '#8b5cf6',
  'CREDITO POR FINANCIERA': '#ec4899',
};

interface DashboardViewProps {
  data: DashboardMetrics | null;
  prevData: DashboardMetrics | null;
  filters: import('../types').Filters;
  /** Ventas del Detalle (fetchVentas) — misma fuente que Detalle de Comprobantes para la matriz de cobros */
  ventasParaCobros: VentaRow[];
  /** Ventas del periodo anterior (mismo rango de días, mes previo) — para gráfico comparativo */
  ventasAnterior: VentaRow[];
  isLoading: boolean;
}

/** Las 4 categorías de negocio en orden fijo de apilado (base → tope) */
const CATEGORIAS = [
  { key: 'CONTADO EFECTIVO', color: '#10b981', label: 'Contado Efectivo' }, // esmeralda
  { key: 'TARJETA', color: '#3b82f6', label: 'Tarjeta' }, // azul
  { key: 'CRÉDITO FINANCIERA', color: '#f59e0b', label: 'Crédito Financiera' }, // ámbar
  { key: 'CUENTA CORRIENTE', color: '#8b5cf6', label: 'Cuenta Corriente' }, // violeta
];

export const DashboardView: React.FC<DashboardViewProps> = ({ data, prevData, filters, ventasParaCobros, ventasAnterior = [], isLoading }) => {
  const formatCurrency = (v: number) =>
    new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 }).format(v);

  const fmtCompact = (v: number) =>
    new Intl.NumberFormat('es-AR', { notation: 'compact', maximumFractionDigits: 1 }).format(v);
  const fmtFull = (v: number) =>
    new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', minimumFractionDigits: 2 }).format(v);

  /* ─── KPIs (Stats) ────────────────────────────────── */
  const stats = useMemo(() => {
    if (!data) return { totalFacturado: 0, margenTotal: 0, rentabilidad: 0, ticketPromedio: 0 };
    const { totalFacturado, margenTotal, rentabilidad, voucherCount } = data.kpis;
    const ticketPromedio = voucherCount > 0 ? totalFacturado / voucherCount : 0;
    return { totalFacturado, margenTotal, rentabilidad, ticketPromedio };
  }, [data]);

  /* ─── Mix de Pagos agrupado — 4 categorías fijas ─── */
  const paymentMix = useMemo(() => {
    if (!data) return [];
    const totals = new Map<string, number>();
    data.stacked_data.forEach(d => {
      totals.set(d.categoria_negocio, (totals.get(d.categoria_negocio) ?? 0) + d.monto);
    });

    const grand = Array.from(totals.values()).reduce((s, v) => s + v, 0) || 1;
    return CATEGORIAS.map(c => {
      const amt = totals.get(c.key) ?? 0;
      return {
        key: c.key,
        label: c.label,
        color: c.color,
        amount: amt,
        pct: Math.round((amt / grand) * 100),
      };
    }).filter(c => c.amount > 0);
  }, [data]);

  /* ─── Categoría seleccionada para filtrar el detalle ─── */
  const [selectedCat, setSelectedCat] = useState<string | null>(null);

  /* ─── Mix Detallado — medios individuales sin agrupar ─── */
  const detailMix = useMemo(() => {
    if (!data) return [];
    const map = new Map<string, { amount: number; cat: string }>();
    data.stacked_data.forEach(d => {
      if (selectedCat && d.categoria_negocio !== selectedCat) return;
      const prev = map.get(d.medio_pago);
      if (prev) prev.amount += d.monto;
      else map.set(d.medio_pago, { amount: d.monto, cat: d.categoria_negocio });
    });

    const allItems = Array.from(map.entries())
      .map(([label, { amount, cat }]) => ({
        label,
        amount,
        color: CATEGORIAS.find(c => c.key === cat)?.color ?? '#94a3b8',
      }))
      .sort((a, b) => b.amount - a.amount);

    const grand = allItems.reduce((s, v) => s + v.amount, 0) || 1;

    if (allItems.length <= 11) {
      return allItems.map(item => ({
        ...item,
        pct: Math.round((item.amount / grand) * 100),
      }));
    }

    const top11 = allItems.slice(0, 11);
    const othersAmount = allItems.slice(11).reduce((s, v) => s + v.amount, 0);

    const result = top11.map(item => ({
      ...item,
      pct: Math.round((item.amount / grand) * 100),
    }));

    result.push({
      label: 'OTROS',
      amount: othersAmount,
      color: '#64748b',
      pct: Math.round((othersAmount / grand) * 100),
    });

    return result;
  }, [data, selectedCat]);

  /* conic-gradient para el pie agrupado */
  const conicGradient = useMemo(() => {
    let acc = 0;
    return paymentMix.map(p => {
      const start = acc;
      acc += p.pct;
      return `${p.color} ${start}% ${acc}%`;
    }).join(', ');
  }, [paymentMix]);

  /* conic-gradient para el pie de detalle */
  const detailConicGradient = useMemo(() => {
    let acc = 0;
    return detailMix.map(p => {
      const start = acc;
      acc += p.pct;
      return `${p.color} ${start}% ${acc}%`;
    }).join(', ');
  }, [detailMix]);

  /* ─── Resumen de Cobros por Sucursal — misma fuente que Detalle (VentaRow[]) ─── */
  const cobrosMatrix = useMemo(() => {
    if (!ventasParaCobros.length) return { categorias: [], sucursales: [], matrix: new Map<string, Map<string, number>>(), rowTotals: new Map<string, number>(), colTotals: new Map<string, number>(), grandTotal: 0 };

    const matrix = new Map<string, Map<string, number>>();
    const rowTotals = new Map<string, number>();
    const colTotals = new Map<string, number>();
    const sucursalesSet = new Set<string>();

    ventasParaCobros.forEach((item: VentaRow) => {
      const cat = getCategoriaCobro(item);
      const suc = item.nro_sucursal;
      const monto = Number(item.totalIVA ?? item.imp_prop_c_iva ?? item.importe_c_iva ?? 0);
      sucursalesSet.add(suc);
      if (!matrix.has(cat)) matrix.set(cat, new Map());
      const row = matrix.get(cat)!;
      row.set(suc, (row.get(suc) ?? 0) + monto);
    });

    const sucursales = Array.from(sucursalesSet).sort((a, b) => {
      const na = parseInt(a, 10); const nb = parseInt(b, 10);
      if (!Number.isNaN(na) && !Number.isNaN(nb)) return na - nb;
      return String(a).localeCompare(String(b));
    });
    const categorias = CATEGORIAS_COBRO.filter(c => matrix.has(c));

    categorias.forEach(cat => {
      const row = matrix.get(cat)!;
      let sum = 0;
      sucursales.forEach(suc => {
        const v = row.get(suc) ?? 0;
        sum += v;
        colTotals.set(suc, (colTotals.get(suc) ?? 0) + v);
      });
      rowTotals.set(cat, sum);
    });

    const grandTotal = Array.from(rowTotals.values()).reduce((a, b) => a + b, 0);

    return { categorias, sucursales, matrix, rowTotals, colTotals, grandTotal };
  }, [ventasParaCobros]);

  /* ─── Totales por sucursal del periodo anterior (para gráfico comparativo) ─── */
  const colTotalsAnterior = useMemo(() => {
    const map = new Map<string, number>();
    (ventasAnterior ?? []).forEach((item: VentaRow) => {
      const suc = String(item.nro_sucursal ?? '').trim();
      if (!suc) return;
      const monto = Number(item.totalIVA ?? item.imp_prop_c_iva ?? item.importe_c_iva ?? 0);
      map.set(suc, (map.get(suc) ?? 0) + monto);
    });
    const size = map.size;
    const totalAnterior = [...map.values()].reduce((a, b) => a + b, 0);
    if (size > 0) console.log('[DashboardView] colTotalsAnterior:', size, 'sucursales, total:', totalAnterior);
    return map;
  }, [ventasAnterior]);

  /* ─── Ventas por Sucursal (gráfico) — actual + anterior, estructura { sucursal, actual, anterior } para Recharts ─── */
  const ventasPorSucursalChart = useMemo(() => {
    const { sucursales, categorias, matrix, colTotals } = cobrosMatrix;
    const allSucs = Array.from(new Set([...sucursales, ...colTotalsAnterior.keys()])).sort((a, b) => {
      const na = parseInt(a, 10); const nb = parseInt(b, 10);
      if (!Number.isNaN(na) && !Number.isNaN(nb)) return na - nb;
      return String(a).localeCompare(String(b));
    });
    if (allSucs.length === 0) return { bars: [], maxTotal: 1 };

    const bars = allSucs.map(suc => {
      const actual = colTotals.get(suc) ?? 0;
      const anterior = colTotalsAnterior.get(suc) ?? 0;
      const segments = categorias
        .map(cat => ({
          cat,
          amount: matrix.get(cat)?.get(suc) ?? 0,
          color: COLORES_COBRO[cat] ?? '#64748b',
        }))
        .filter(s => s.amount > 0);

      return {
        suc,
        sucursal: `Suc. ${suc}`,
        name: `Suc. ${suc}`,
        actual,
        anterior,
        segments,
      };
    });

    const maxTotal = Math.max(
      ...bars.flatMap(b => [b.actual, b.anterior]),
      1
    );

    return { bars, maxTotal };
  }, [cobrosMatrix, colTotalsAnterior]);

  /* ─── Spinner overlay ──────────────────────────────── */
  const Spinner = () => (
    <div className="absolute inset-0 flex items-center justify-center z-30 bg-[#020617]/70 backdrop-blur-sm">
      <div className="flex flex-col items-center gap-3">
        <Loader2 size={36} className="animate-spin text-primary" />
        <span className="text-sm text-slate-400">Cargando datos locales...</span>
      </div>
    </div>
  );

  return (
    <div className="flex-1 overflow-y-auto p-8 relative">
      {isLoading && <Spinner />}
      <div className="max-w-[1800px] mx-auto flex flex-col gap-8">

        {/* KPI Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-8">
          <StatsCard title="Total Facturado" value={formatCurrency(stats.totalFacturado)} trend={0} subtitle="Suma imp_prop_c_iva" icon="money" />
          <StatsCard title="Margen Total" value={formatCurrency(stats.margenTotal)} trend={0} subtitle="Suma margen_contribucion" icon="money" />
          <StatsCard title="% Rentabilidad" value={`${stats.rentabilidad.toFixed(1)}%`} trend={0} subtitle="Margen / Venta Total" icon="percent" />
          <StatsCard title="Ticket Promedio" value={formatCurrency(stats.ticketPromedio)} trend={0} subtitle="Facturado / Comprobantes" icon="ticket" />
        </div>

        {/* Charts Row — Ventas por Sucursal + Mix de Pagos */}
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-6" style={{ gridTemplateColumns: '1fr 1fr', minHeight: 520 }}>
          {/* Stacked Bar Chart — Ventas por Sucursal × Medio de Pago */}
          <div className="bg-card-dark rounded-xl border border-border-dark p-5 flex flex-col shadow-sm">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-white">Ventas por Sucursal</h3>
              <span className="text-xs text-slate-400">Desglose por Medio de Pago</span>
            </div>

            {ventasPorSucursalChart.bars.length === 0 ? (
              <div className="flex-1 flex items-center justify-center text-slate-500 text-sm">Sin datos para el período</div>
            ) : (() => {
              const BAR_AREA_H = 290;
              const { bars, maxTotal } = ventasPorSucursalChart;
              const COLOR_ACTUAL = '#1269e2';
              const COLOR_ANTERIOR = '#64748b';

              const renderBar = (
                barH: number,
                total: number,
                isAnterior: boolean,
                segments?: { cat: string; amount: number; color: string }[]
              ) => {
                if (barH === 0) return <div style={{ maxWidth: 34, width: 34 }} />;
                const bg = isAnterior ? COLOR_ANTERIOR : undefined;
                return (
                  <div
                    className="relative flex flex-col items-center group/bar"
                    style={{ height: BAR_AREA_H, maxWidth: 34 }}
                  >
                    <span
                      className={`text-[8px] whitespace-nowrap font-medium ${isAnterior ? 'text-slate-600' : 'text-slate-400'}`}
                      style={{ marginBottom: BAR_AREA_H - barH + 2 }}
                    >
                      {fmtCompact(total)}
                    </span>
                    <div
                      className={`relative w-full flex flex-col-reverse rounded-t-sm overflow-visible ${isAnterior ? 'opacity-70' : ''}`}
                      style={{ height: barH }}
                    >
                      {isAnterior || !segments?.length ? (
                        <div
                          className="w-full h-full rounded-t-sm"
                          style={{ backgroundColor: bg ?? COLOR_ACTUAL }}
                        />
                      ) : (
                        segments.map((seg, si) => {
                          if (seg.amount === 0) return null;
                                const segH = total > 0 ? Math.max(Math.round((seg.amount / total) * barH), 2) : 0;
                          return (
                            <div
                              key={si}
                              className="relative w-full flex-shrink-0"
                              style={{ height: segH, backgroundColor: seg.color }}
                            />
                          );
                        })
                      )}
                    </div>
                  </div>
                );
              };

              return (
                <>
                  <div
                    className="relative flex items-end justify-between gap-3 px-4"
                    style={{ height: BAR_AREA_H }}
                  >
                    <div className="absolute inset-0 flex flex-col justify-between pointer-events-none">
                      {[0, 1, 2, 3, 4].map(i => (
                        <div key={i} className="w-full h-px border-t border-dashed border-slate-800/80" />
                      ))}
                    </div>

                    {bars.map((branch, bi) => {
                      const hActual = Math.max(Math.round((branch.actual / maxTotal) * BAR_AREA_H), branch.actual > 0 ? 4 : 0);
                      const hAnterior = Math.max(Math.round((branch.anterior / maxTotal) * BAR_AREA_H), branch.anterior > 0 ? 4 : 0);
                      const pctVar = branch.anterior > 0
                        ? ((branch.actual - branch.anterior) / branch.anterior) * 100
                        : null;

                      return (
                        <div key={bi} className="relative flex flex-col flex-1 min-w-0 z-10 items-center group/suc">
                          <div className="flex items-end justify-center gap-2 w-full">
                            {renderBar(hAnterior, branch.anterior, true)}
                            {renderBar(hActual, branch.actual, false, branch.segments)}
                          </div>
                          {/* Tooltip con ambos valores y variación */}
                          <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 hidden group-hover/suc:flex flex-col items-center z-30 pointer-events-none">
                            <div className="bg-slate-900 border border-slate-700 text-white text-[10px] py-2 px-3 rounded shadow-xl whitespace-nowrap min-w-[160px]">
                              <div className="font-semibold text-slate-200 mb-1.5">{branch.name}</div>
                              <div className="flex items-center gap-1.5 mb-1">
                                <span className="size-2 rounded-sm shrink-0" style={{ backgroundColor: COLOR_ACTUAL }} />
                                <span className="text-slate-400">Mes Actual:</span>
                                <span className="text-emerald-400 font-medium">{fmtFull(branch.actual)}</span>
                              </div>
                              <div className="flex items-center gap-1.5 mb-1">
                                <span className="size-2 rounded-sm shrink-0" style={{ backgroundColor: COLOR_ANTERIOR }} />
                                <span className="text-slate-400">Mes Anterior:</span>
                                <span className="text-slate-300">{fmtFull(branch.anterior)}</span>
                              </div>
                              {pctVar !== null && (
                                <div className={`border-t border-slate-700 pt-1 mt-1 font-semibold ${pctVar >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                                  {pctVar >= 0 ? '▲' : '▼'} {Math.abs(pctVar).toFixed(1)}% vs mes anterior
                                </div>
                              )}
                            </div>
                            <div className="size-1.5 bg-slate-900 rotate-45 -mt-1 border-r border-b border-slate-700" />
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  <div className="flex justify-between gap-4 px-2 mt-2">
                    {bars.map((branch, bi) => (
                      <span key={bi} className="flex-1 text-[10px] text-slate-400 font-medium truncate text-center">
                        {branch.name}
                      </span>
                    ))}
                  </div>

                  <div className="flex flex-wrap items-center gap-x-5 gap-y-2 mt-3 pt-3 border-t border-slate-800">
                    <div className="flex items-center gap-1.5">
                      <span className="w-5 h-2.5 rounded-sm shrink-0" style={{ backgroundColor: COLOR_ANTERIOR }} />
                      <span className="text-[10px] text-slate-500">Mes Anterior</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <span className="w-5 h-2.5 rounded-sm shrink-0" style={{ backgroundColor: COLOR_ACTUAL }} />
                      <span className="text-[10px] text-slate-300 font-medium">Mes Actual</span>
                    </div>
                    <span className="text-slate-700">|</span>
                    {cobrosMatrix.categorias.map(cat => (
                      <div key={cat} className="flex items-center gap-1.5">
                        <span className="size-2 rounded-sm shrink-0" style={{ backgroundColor: COLORES_COBRO[cat] ?? '#64748b' }} />
                        <span className="text-[10px] text-slate-400 whitespace-nowrap">{cat.replace(/_/g, ' ')}</span>
                      </div>
                    ))}
                  </div>
                </>
              );
            })()}
          </div>

          {/* Mix de Pagos — card doble */}
          <div className="bg-card-dark rounded-xl border border-border-dark p-6 flex flex-col shadow-sm gap-5">
            {/* Header */}
            <div className="flex items-start justify-between gap-2">
              <div>
                <h3 className="text-base font-semibold text-white leading-tight">Mix de Pagos</h3>
                <p className="text-[11px] text-slate-500 mt-0.5">Clic en una categoría para filtrar el detalle</p>
              </div>
              {selectedCat && (
                <button
                  onClick={() => setSelectedCat(null)}
                  className="text-[10px] text-sky-400 hover:text-sky-300 whitespace-nowrap border border-sky-800 rounded px-2 py-0.5 transition-colors"
                >
                  × Limpiar filtro
                </button>
              )}
            </div>

            {/* Dos paneles */}
            <div className="flex gap-5 flex-1 min-h-0" style={{ minHeight: 360 }}>

              {/* ── Panel A: 4 Categorías agrupadas (donut + leyenda clicable) ── */}
              <div className="flex-1 flex flex-col items-center gap-3 min-w-0">
                <span className="text-[10px] text-slate-500 self-start font-medium uppercase tracking-wide">Agrupado</span>
                {paymentMix.length === 0 ? (
                  <span className="text-slate-500 text-xs flex-1 flex items-center">Sin datos</span>
                ) : (
                  <>
                    {/* Donut */}
                    <div
                      className="relative rounded-full shrink-0 cursor-default"
                      style={{ width: 200, height: 200, background: `conic-gradient(${conicGradient || '#1e293b 0% 100%'})` }}
                    >
                      <div
                        className="absolute inset-0 m-auto rounded-full bg-card-dark flex flex-col items-center justify-center"
                        style={{ width: 130, height: 130 }}
                      >
                        <span className="text-xl font-bold text-white leading-tight">
                          {selectedCat
                            ? `${paymentMix.find(p => p.key === selectedCat)?.pct ?? 0}%`
                            : `${paymentMix[0]?.pct ?? 0}%`}
                        </span>
                        <span className="text-[9px] text-slate-400 text-center px-1 leading-tight">
                          {selectedCat
                            ? CATEGORIAS.find(c => c.key === selectedCat)?.label
                            : paymentMix[0]?.label}
                        </span>
                      </div>
                    </div>
                    {/* Leyenda clicable */}
                    <div className="w-full flex flex-col gap-1">
                      {paymentMix.map(p => (
                        <button
                          key={p.key}
                          onClick={() => setSelectedCat(prev => prev === p.key ? null : p.key)}
                          className={`w-full flex items-center gap-2 rounded-md px-2 py-1 text-left transition-all ${selectedCat === p.key
                            ? 'bg-slate-700/70 ring-1 ring-slate-600'
                            : 'hover:bg-slate-800/60'
                            }`}
                        >
                          <span className="size-2.5 rounded-sm shrink-0" style={{ backgroundColor: p.color }} />
                          <span className="text-[10px] text-slate-300 flex-1 truncate">{p.label}</span>
                          <span className="text-[10px] font-bold shrink-0" style={{ color: p.color }}
                            title={fmtFull(p.amount)}>
                            {p.pct}%
                          </span>
                        </button>
                      ))}
                    </div>
                  </>
                )}
              </div>

              {/* Divisor */}
              <div className="w-px bg-slate-800 self-stretch" />

              {/* ── Panel B: Medios individuales (barras horizontales) ── */}
              <div className="flex-1 flex flex-col gap-2 min-w-0">
                <span className="text-[10px] text-slate-500 font-medium uppercase tracking-wide">
                  {selectedCat
                    ? `${CATEGORIAS.find(c => c.key === selectedCat)?.label}`
                    : 'Detalle individual'}
                </span>
                {detailMix.length === 0 ? (
                  <span className="text-slate-500 text-xs flex items-center flex-1">Sin datos</span>
                ) : (
                  <div className="flex flex-col gap-2 overflow-y-auto flex-1 pr-0.5">
                    {detailMix.map((d, i) => (
                      <div key={i} className="group relative">
                        {/* Tooltip */}
                        <div className="absolute left-0 bottom-full mb-1 z-30 hidden group-hover:flex flex-col pointer-events-none">
                          <div className="bg-slate-900 border border-slate-700 text-white text-[10px] py-1.5 px-2.5 rounded shadow-xl whitespace-nowrap">
                            <span className="font-semibold block">{d.label}</span>
                            <span className="text-emerald-400">{fmtFull(d.amount)}</span>
                            <span className="text-slate-400 ml-1.5">({d.pct}%)</span>
                          </div>
                          <div className="size-1.5 bg-slate-900 rotate-45 -mt-1 ml-3 border-r border-b border-slate-700" />
                        </div>
                        <div className="flex items-center justify-between mb-0.5">
                          <span className="text-[9px] text-slate-400 truncate max-w-[95px]">{d.label}</span>
                          <span className="text-[9px] text-slate-500 shrink-0 ml-1">{d.pct}%</span>
                        </div>
                        <div className="h-1.5 bg-slate-800 rounded-full overflow-hidden">
                          <div
                            className="h-full rounded-full transition-all duration-500"
                            style={{ width: `${Math.max(d.pct, 2)}%`, backgroundColor: d.color }}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

            </div>
          </div>
        </div>

        {/* Resumen de Cobros por Sucursal — misma fuente que Detalle de Comprobantes */}
        <div className="bg-card-dark rounded-xl border border-border-dark shadow-sm overflow-hidden">
          <div className="p-4 border-b border-border-dark">
            <h3 className="text-lg font-semibold text-white">Resumen de Cobros por Sucursal</h3>
            <p className="text-xs text-slate-500 mt-0.5">Total cIVA por categoría de medio de pago y sucursal</p>
          </div>
          <div className="overflow-x-auto">
            {cobrosMatrix.categorias.length === 0 ? (
              <div className="px-6 py-12 text-center text-slate-500 text-sm">Sin datos para el período</div>
            ) : (
              <table className="w-full text-sm border-collapse">
                <thead className="bg-[#0f172a] text-xs uppercase font-semibold text-slate-300 sticky top-0 z-20 border-b border-border-dark">
                  <tr>
                    <th className="px-4 py-3.5 text-left tracking-wide whitespace-nowrap">Categoría</th>
                    {cobrosMatrix.sucursales.map(suc => (
                      <th key={suc} className="px-4 py-3.5 text-right tracking-wide whitespace-nowrap">Suc. {suc}</th>
                    ))}
                    <th className="px-4 py-3.5 text-right tracking-wide whitespace-nowrap border-l border-border-dark text-primary">TOTALES</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border-dark bg-[#020617]">
                  {cobrosMatrix.categorias.map(cat => (
                    <tr key={cat} className="hover:bg-slate-800/40 transition-colors border-b border-border-dark">
                      <td className="px-4 py-3 font-medium text-slate-200 whitespace-nowrap">{cat.replace(/_/g, ' ')}</td>
                      {cobrosMatrix.sucursales.map(suc => (
                        <td key={suc} className="px-4 py-3 text-right text-slate-400 tabular-nums">
                          {formatCurrency(cobrosMatrix.matrix.get(cat)?.get(suc) ?? 0)}
                        </td>
                      ))}
                      <td className="px-4 py-3 text-right font-semibold text-white tabular-nums border-l border-border-dark">
                        {formatCurrency(cobrosMatrix.rowTotals.get(cat) ?? 0)}
                      </td>
                    </tr>
                  ))}
                  <tr className="bg-[#0f172a]/90 font-semibold border-t-2 border-primary/30">
                    <td className="px-4 py-3.5 text-slate-200 whitespace-nowrap">TOTALES</td>
                    {cobrosMatrix.sucursales.map(suc => (
                      <td key={suc} className="px-4 py-3.5 text-right text-white tabular-nums">
                        {formatCurrency(cobrosMatrix.colTotals.get(suc) ?? 0)}
                      </td>
                    ))}
                    <td className="px-4 py-3.5 text-right font-bold text-primary tabular-nums border-l border-border-dark">
                      {formatCurrency(cobrosMatrix.grandTotal)}
                    </td>
                  </tr>
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
