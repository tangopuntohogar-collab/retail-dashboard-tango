import React, { useMemo, useState } from 'react';
import { StatsCard } from './StatsCard';
import { VentaRow, PaymentMix, RubroPoint, DashboardMetrics } from '../types';
import { MoreHorizontal, Loader2 } from 'lucide-react';

interface DashboardViewProps {
  data: DashboardMetrics | null;
  prevData: DashboardMetrics | null;
  filters: import('../types').Filters;
  isLoading: boolean;
}

/** Las 4 categorías de negocio en orden fijo de apilado (base → tope) */
const CATEGORIAS = [
  { key: 'CONTADO EFECTIVO', color: '#10b981', label: 'Contado Efectivo' }, // esmeralda
  { key: 'TARJETA', color: '#3b82f6', label: 'Tarjeta' }, // azul
  { key: 'CRÉDITO FINANCIERA', color: '#f59e0b', label: 'Crédito Financiera' }, // ámbar
  { key: 'CUENTA CORRIENTE', color: '#8b5cf6', label: 'Cuenta Corriente' }, // violeta
];

export const DashboardView: React.FC<DashboardViewProps> = ({ data, prevData, filters, isLoading }) => {
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

  /* ─── Helper: transforma data de RPC a formato de gráfico ─── */
  const { stackedData, maxTotal } = useMemo(() => {
    if (!data) return { stackedData: [], maxTotal: 1 };

    // Agrupar por sucursal
    const currMap = new Map<string, any>();
    data.stacked_data.forEach(d => {
      if (!currMap.has(d.nro_sucursal)) {
        currMap.set(d.nro_sucursal, {
          total: 0,
          segments: CATEGORIAS.map(c => ({ ...c, amount: 0, breakdown: [] as [string, number][] }))
        });
      }
      const branch = currMap.get(d.nro_sucursal)!;
      branch.total += d.monto;
      const segment = branch.segments.find((s: any) => s.key === d.categoria_negocio);
      if (segment) {
        segment.amount += d.monto;
        segment.breakdown.push([d.medio_pago, d.monto]);
      }
    });

    // Lo mismo para el período previo
    const prevMap = new Map<string, any>();
    if (prevData) {
      prevData.stacked_data.forEach(d => {
        if (!prevMap.has(d.nro_sucursal)) {
          prevMap.set(d.nro_sucursal, {
            total: 0,
            segments: CATEGORIAS.map(c => ({ ...c, amount: 0, breakdown: [] as [string, number][] }))
          });
        }
        const branch = prevMap.get(d.nro_sucursal)!;
        branch.total += d.monto;
        const segment = branch.segments.find((s: any) => s.key === d.categoria_negocio);
        if (segment) {
          segment.amount += d.monto;
          segment.breakdown.push([d.medio_pago, d.monto]);
        }
      });
    }

    const allSucs = Array.from(new Set([...currMap.keys(), ...prevMap.keys()]));
    const result = allSucs
      .map(suc => ({
        suc,
        name: `Suc. ${suc}`,
        curr: currMap.get(suc) ?? { total: 0, segments: CATEGORIAS.map(c => ({ ...c, amount: 0, breakdown: [] })) },
        prev: prevMap.get(suc) ?? { total: 0, segments: CATEGORIAS.map(c => ({ ...c, amount: 0, breakdown: [] })) },
      }))
      .sort((a, b) => b.curr.total - a.curr.total);

    const maxTotal = Math.max(
      ...result.map(d => Math.max(d.curr.total, d.prev.total)),
      1
    );

    return { stackedData: result, maxTotal };
  }, [data, prevData]);

  /* ─── Etiquetas de período para la leyenda / tooltip ─── */
  const prevLabel = useMemo(() => {
    if (!filters.fechaDesde) return 'Mes Anterior';
    const d = new Date(`${filters.fechaDesde}T00:00:00Z`); // Usamos Z para precisión
    d.setUTCMonth(d.getUTCMonth() - 1);
    return d.toLocaleDateString('es-AR', { month: 'long', year: 'numeric' });
  }, [filters.fechaDesde]);

  const currLabel = useMemo(() => {
    if (!filters.fechaDesde) return 'Período Actual';
    const d = new Date(`${filters.fechaDesde}T00:00:00Z`);
    return d.toLocaleDateString('es-AR', { month: 'long', year: 'numeric' });
  }, [filters.fechaDesde]);

  const BAR_AREA_H = 240;

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

  /* ─── Top 5 Artículos ──────────────────────────────── */
  const topArticulos = useMemo(() => {
    return data?.top_articles ?? [];
  }, [data]);

  /* ─── Dispersión Rentabilidad por Rubro ────────────── */
  const rubroPoints = useMemo(() => {
    return data?.rubro_points ?? [];
  }, [data]);

  const maxCant = rubroPoints.reduce((m, p) => Math.max(m, p.total_cantidad ?? 0), 1);
  const maxMargen = rubroPoints.reduce((m, p) => Math.max(m, p.avg_margen ?? 0), 1);
  const minMargen = rubroPoints.reduce((m, p) => Math.min(m, p.avg_margen ?? 0), 0);

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

        {/* Charts Row */}
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-6" style={{ gridTemplateColumns: '5fr 6fr', height: 480 }}>
          {/* Stacked Bar Chart — Ventas por Sucursal × Medio de Pago */}
          <div className="bg-card-dark rounded-xl border border-border-dark p-5 flex flex-col shadow-sm">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-white">Ventas por Sucursal</h3>
              <span className="text-xs text-slate-400">Desglose por Medio de Pago</span>
            </div>

            {stackedData.length === 0 ? (
              <div className="flex-1 flex items-center justify-center text-slate-500 text-sm">Sin datos para el período</div>
            ) : (() => {
              // Altura fija del área de barras en píxeles — así los % internos se resuelven correctamente
              const BAR_AREA_H = 290;
              return (
                <>
                  {/* Área de barras con altura fija */}
                  <div
                    className="relative flex items-end justify-between gap-3 px-4"
                    style={{ height: BAR_AREA_H }}
                  >
                    {/* Grid lines */}
                    <div className="absolute inset-0 flex flex-col justify-between pointer-events-none">
                      {[0, 1, 2, 3, 4].map(i => (
                        <div key={i} className="w-full h-px border-t border-dashed border-slate-800/80" />
                      ))}
                    </div>

                    {stackedData.map((branch, bi) => {
                      const currH = Math.max(Math.round((branch.curr.total / maxTotal) * BAR_AREA_H), branch.curr.total > 0 ? 4 : 0);
                      const prevH = Math.max(Math.round((branch.prev.total / maxTotal) * BAR_AREA_H), branch.prev.total > 0 ? 4 : 0);
                      const pct = branch.prev.total > 0
                        ? ((branch.curr.total - branch.prev.total) / branch.prev.total) * 100
                        : null;

                      /** Renders one stacked bar (prev or curr) */
                      const renderBar = (
                        barH: number,
                        segments: typeof branch.curr.segments,
                        total: number,
                        isPrev: boolean,
                        periodLabel: string
                      ) => {
                        if (barH === 0) return <div style={{ maxWidth: 34, width: 34 }} />;
                        return (
                          <div
                            className="relative flex flex-col items-center"
                            style={{ height: BAR_AREA_H, maxWidth: 34 }}
                          >
                            {/* Total label */}
                            <span
                              className={`text-[8px] whitespace-nowrap font-medium ${isPrev ? 'text-slate-600' : 'text-slate-400'}`}
                              style={{ marginBottom: BAR_AREA_H - barH + 2 }}
                            >
                              {fmtCompact(total)}
                            </span>
                            {/* Stacked bar */}
                            <div
                              className={`relative w-full flex flex-col-reverse rounded-t-sm overflow-visible ${isPrev ? 'opacity-50' : ''}`}
                              style={{ height: barH }}
                            >
                              {segments.map((seg, si) => {
                                if (seg.amount === 0) return null;
                                const segH = Math.max(Math.round((seg.amount / total) * barH), 2);
                                return (
                                  <div
                                    key={si}
                                    className="relative group/seg w-full"
                                    style={{ height: segH, backgroundColor: seg.color, flexShrink: 0 }}
                                  >
                                    {/* Tooltip */}
                                    <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 hidden group-hover/seg:flex flex-col items-center z-30 pointer-events-none">
                                      <div className="bg-slate-900 border border-slate-700 text-white text-[10px] py-2 px-3 rounded shadow-xl whitespace-nowrap min-w-[170px]">
                                        {/* Período */}
                                        <div className={`text-[9px] mb-1 font-medium ${isPrev ? 'text-slate-400' : 'text-sky-400'}`}>
                                          {isPrev ? '◀ ' : '▶ '}{periodLabel}
                                        </div>
                                        {/* Categoría + monto */}
                                        <div className="flex items-center gap-1.5 mb-1">
                                          <span className="size-2 rounded-sm shrink-0" style={{ backgroundColor: seg.color }} />
                                          <span className="font-semibold">{seg.label}</span>
                                        </div>
                                        <span className="text-emerald-400 font-medium block mb-1">
                                          {fmtFull(seg.amount)}
                                        </span>
                                        {/* Desglose de medios */}
                                        {seg.breakdown.length > 1 && (
                                          <div className="border-t border-slate-700 pt-1 mt-0.5 flex flex-col gap-0.5">
                                            {seg.breakdown.slice(0, 3).map(([medio, monto], mi) => (
                                              <div key={mi} className="flex justify-between gap-3 text-slate-400">
                                                <span className="truncate max-w-[100px]">{medio}</span>
                                                <span className="font-mono">{fmtCompact(monto)}</span>
                                              </div>
                                            ))}
                                            {seg.breakdown.length > 3 && <span className="text-slate-500">+{seg.breakdown.length - 3} más</span>}
                                          </div>
                                        )}
                                        {/* % variación (solo barra actual) */}
                                        {!isPrev && pct !== null && (
                                          <div className={`border-t border-slate-700 pt-1 mt-1 flex items-center gap-1 font-semibold ${pct >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                                            <span>{pct >= 0 ? '▲' : '▼'}</span>
                                            <span>{Math.abs(pct).toFixed(1)}% vs {prevLabel}</span>
                                          </div>
                                        )}
                                      </div>
                                      <div className="size-1.5 bg-slate-900 rotate-45 -mt-1 border-r border-b border-slate-700" />
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        );
                      };

                      return (
                        <div key={bi} className="flex flex-col flex-1 min-w-0 z-10">
                          {/* Par de barras */}
                          <div className="flex items-end justify-center gap-2 w-full">
                            {renderBar(prevH, branch.prev.segments, branch.prev.total, true, prevLabel)}
                            {renderBar(currH, branch.curr.segments, branch.curr.total, false, currLabel)}
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  {/* Etiquetas de sucursal */}
                  <div className="flex justify-between gap-4 px-2 mt-2">
                    {stackedData.map((branch, bi) => (
                      <span key={bi} className="flex-1 text-[10px] text-slate-400 font-medium truncate text-center">
                        {branch.name}
                      </span>
                    ))}
                  </div>

                  {/* Leyenda dual */}
                  <div className="flex flex-wrap items-center gap-x-5 gap-y-2 mt-3 pt-3 border-t border-slate-800">
                    {/* Período */}
                    <div className="flex items-center gap-1.5">
                      <span className="w-5 h-2.5 rounded-sm bg-emerald-500 opacity-50 shrink-0" />
                      <span className="text-[10px] text-slate-500 whitespace-nowrap capitalize">{prevLabel}</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <span className="w-5 h-2.5 rounded-sm bg-emerald-500 shrink-0" />
                      <span className="text-[10px] text-slate-300 font-medium whitespace-nowrap capitalize">{currLabel}</span>
                    </div>
                    {/* Separador */}
                    <span className="text-slate-700">|</span>
                    {/* 4 categorías */}
                    {CATEGORIAS.map(cat => (
                      <div key={cat.key} className="flex items-center gap-1.5">
                        <span className="size-2 rounded-sm shrink-0" style={{ backgroundColor: cat.color }} />
                        <span className="text-[10px] text-slate-400 whitespace-nowrap">{cat.label}</span>
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

        {/* Bottom Row */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Top Articles */}
          <div className="lg:col-span-2 bg-card-dark rounded-xl border border-border-dark shadow-sm overflow-hidden flex flex-col">
            <div className="p-6 border-b border-border-dark flex justify-between items-center">
              <h3 className="text-lg font-semibold text-white">Top 5 Artículos</h3>
              <button className="text-xs text-primary font-medium hover:underline">Ver Todos</button>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm text-slate-400">
                <thead className="bg-[#111418] text-xs uppercase font-medium text-slate-300">
                  <tr>
                    <th className="px-6 py-3">#</th>
                    <th className="px-6 py-3">Descripción</th>
                    <th className="px-6 py-3 text-right">Cantidad</th>
                    <th className="px-6 py-3 text-right">Rent. %</th>
                    <th className="px-6 py-3 text-right">Venta Total</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border-dark">
                  {topArticulos.length === 0 ? (
                    <tr><td colSpan={5} className="px-6 py-8 text-center text-slate-500">Sin datos para el período seleccionado</td></tr>
                  ) : topArticulos.map((item, i) => (
                    <tr key={i} className="hover:bg-slate-800/50 transition-colors">
                      <td className="px-6 py-4 font-medium text-white">{String(i + 1).padStart(2, '0')}</td>
                      <td className="px-6 py-4 flex items-center gap-3">
                        <div
                          className="size-8 rounded bg-slate-700 bg-cover bg-center shrink-0"
                          style={{ backgroundImage: `url(https://picsum.photos/seed/${item.cod_articu}/100/100)` }}
                        />
                        <span className="font-medium text-white truncate max-w-[200px]">{item.descripcio}</span>
                      </td>
                      <td className="px-6 py-4 text-right">{(item.cant ?? 0).toFixed(0)}</td>
                      <td className={`px-6 py-4 text-right font-medium ${(item.margen ?? 0) >= 0 ? 'text-emerald-500' : 'text-rose-500'}`}>
                        {(item.margen ?? 0).toFixed(1)}%
                      </td>
                      <td className="px-6 py-4 text-right text-white">{formatCurrency(item.total)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Dispersión Rentabilidad por Rubro */}
          <div className="bg-card-dark rounded-xl border border-border-dark p-6 flex flex-col shadow-sm">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-white">Dispersión Rentabilidad</h3>
              <button className="text-slate-400 hover:text-white"><MoreHorizontal size={20} /></button>
            </div>
            <p className="text-xs text-slate-500 mb-6">Rubros: Margen % vs Cantidad</p>
            <div className="flex-1 relative border-l border-b border-slate-700 mx-2 mb-2 min-h-[250px]">
              <span className="absolute -left-6 top-0 bottom-0 m-auto h-4 w-20 -rotate-90 text-[10px] text-slate-500 text-center">Margen %</span>
              <span className="absolute left-0 right-0 -bottom-6 m-auto h-4 text-[10px] text-slate-500 text-center">Cantidad</span>
              {[25, 50, 75].map(pct => (
                <div key={pct} className="absolute w-full h-px bg-slate-800 border-t border-dashed border-slate-700/50" style={{ top: `${pct}%` }} />
              ))}
              {rubroPoints.map((pt, i) => {
                const range = maxMargen - minMargen || 1;
                const left = (pt.total_cantidad / maxCant) * 88 + 5;
                const bottom = ((pt.avg_margen - minMargen) / range) * 80 + 10;
                const size = Math.max(8, Math.min(22, (pt.total_cantidad / maxCant) * 20 + 8));
                return (
                  <div
                    key={i}
                    className="absolute group"
                    style={{ left: `${left}%`, bottom: `${bottom}%` }}
                  >
                    <div
                      className="rounded-full border-2 border-white shadow-lg cursor-pointer hover:scale-125 transition-transform"
                      style={{
                        width: size,
                        height: size,
                        backgroundColor: ['#3b82f6', '#f59e0b', '#10b981', '#8b5cf6', '#f43f5e', '#06b6d4'][i % 6],
                      }}
                    />
                    <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 bg-slate-900 text-white text-[10px] py-1 px-2 rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap z-20 pointer-events-none border border-slate-700">
                      {pt.rubro}: {(pt.avg_margen ?? 0).toFixed(1)}%
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
