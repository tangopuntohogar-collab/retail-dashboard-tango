import React from 'react';
import { StockMatrixRow } from '../types';
import { Loader2, Info } from 'lucide-react';

interface StockTableProps {
  data: StockMatrixRow[];
  isLoading: boolean;
  periodoAnalisis: '12m' | '6m' | '3m' | '1m' | '30d';
  statsSucursal: string; // La sucursal de la cual mostrar estadísticas (ej. '1008' o '1001')
}

export const StockTable: React.FC<StockTableProps> = ({ data, isLoading, periodoAnalisis, statsSucursal }) => {

  const formatCurrency = (val: number | null) =>
    new Intl.NumberFormat('es-AR', {
      style: 'currency',
      currency: 'ARS',
      minimumFractionDigits: 2,
    }).format(val ?? 0);

  // Mapeo de periodo a texto descriptivo para el tooltip
  const periodLabels: { [key: string]: string } = {
    '12m': 'últimos 12 meses',
    '6m': 'últimos 6 meses',
    '3m': 'últimos 3 meses',
    '1m': 'último mes',
    '30d': 'últimos 30 días'
  };

  // Mapeo de periodo a key del objeto StockStat
  const periodToKey: { [key: string]: keyof import('../types').StockStat } = {
    '12m': 'prom12m',
    '6m': 'prom6m',
    '3m': 'prom3m',
    '1m': 'prom1m',
    '30d': 'venta30d'
  };

  const statKey = periodToKey[periodoAnalisis];

  // Obtener lista única de sucursales presentes en los datos
  const allSucursales = Array.from(
    new Set(data.flatMap(item => Object.keys(item.sucursales)))
  ).sort() as string[];

  // Totales por sucursal para el footer
  const branchTotals = allSucursales.reduce((acc, suc) => {
    acc[suc] = data.reduce((sum, item) => sum + (item.sucursales[suc] || 0), 0);
    return acc;
  }, {} as { [key: string]: number });

  const grandTotal = data.reduce((acc, item) => acc + item.stock_total, 0);

  return (
    <div className="flex-1 overflow-auto relative w-full">
      {isLoading && (
        <div className="absolute inset-0 flex items-center justify-center z-30 bg-[#020617]/80 backdrop-blur-sm">
          <div className="flex flex-col items-center gap-3">
            <Loader2 size={32} className="animate-spin text-primary" />
            <span className="text-sm text-slate-400">Cargando stock...</span>
          </div>
        </div>
      )}
      <div className="min-w-max">
        <table className="w-full text-left text-sm text-slate-400 border-collapse">
          <thead className="bg-[#0f172a] text-xs uppercase font-semibold text-slate-300 sticky top-0 z-20 border-b border-border-dark shadow-sm">
            <tr>
              <th className="px-4 py-3.5 w-[105px] whitespace-nowrap">Cód. Art.</th>
              <th className="px-4 py-3.5 min-w-[220px]">Descripción</th>
              <th className="px-4 py-3.5 min-w-[120px]">Familia</th>
              <th className="px-3 py-3 text-left text-[10px] font-semibold text-slate-400 uppercase tracking-wider">Últ. Compra</th>
              <th className="px-3 py-3 text-right text-[10px] font-semibold text-slate-400 uppercase tracking-wider">Costo Unit.</th>
              
              {/* Columnas Dinámicas de Sucursales */}
              {allSucursales.map(suc => (
                <th key={suc} className="px-3 py-3 text-right text-[10px] font-bold text-primary uppercase tracking-wider border-l border-border-dark bg-primary/5">
                  Suc. {suc}
                </th>
              ))}
              
              <th className="px-4 py-3.5 text-right text-[10px] font-bold text-emerald-400 uppercase tracking-wider border-l border-emerald-500/30 bg-emerald-500/5">
                TOTAL GRAL.
              </th>

              {/* Columna de Venta Promedio */}
              <th className="px-4 py-3.5 text-right text-[10px] font-bold text-orange-400 uppercase tracking-wider border-l border-orange-500/30 bg-orange-500/5 whitespace-nowrap">
                VENTA PROM.
              </th>

              {/* Columna de Cobertura */}
              <th className="px-4 py-3.5 text-right text-[10px] font-bold text-slate-300 uppercase tracking-wider border-l border-slate-700 bg-slate-800/50 whitespace-nowrap">
                <div className="flex items-center justify-end gap-1.5 group/header">
                  COBERTURA
                  <div className="relative cursor-help">
                    <Info size={12} className="text-slate-500 group-hover/header:text-slate-300 transition-colors" />
                    <div className="absolute bottom-full right-0 mb-2 w-48 p-2 bg-slate-900 border border-slate-700 rounded shadow-xl text-[10px] normal-case font-normal text-slate-300 opacity-0 group-hover/header:opacity-100 pointer-events-none transition-opacity z-50">
                      Días estimados de stock basados en el promedio de los {periodLabels[periodoAnalisis]}.
                    </div>
                  </div>
                </div>
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border-dark bg-[#020617]">
            {!isLoading && data.length === 0 ? (
              <tr>
                <td colSpan={5 + allSucursales.length + 3} className="px-5 py-12 text-center text-slate-500">
                  No se encontraron saldos de stock para los filtros seleccionados.
                </td>
              </tr>
            ) : (
              data.map((item) => {
                const statValue = item.stats[statsSucursal]?.[statKey] ?? 
                                 item.stats['1001']?.[statKey] ?? 0;

                const ventaDiaria = statValue / 30;
                let diasCobertura: number | null = null;
                let coverageStatus: 'low' | 'high' | 'normal' | 'none' = 'normal';

                if (ventaDiaria > 0) {
                  diasCobertura = Math.round(item.stock_total / ventaDiaria);
                  if (diasCobertura < 7) coverageStatus = 'low';
                  else if (diasCobertura > 90) coverageStatus = 'high';
                } else {
                  coverageStatus = 'none';
                }

                return (
                  <tr
                    key={item.cod_art}
                    className="hover:bg-slate-800/40 transition-colors group border-b border-border-dark last:border-0"
                  >
                    <td className="px-4 py-3 font-mono text-xs text-slate-400 whitespace-nowrap">
                      {item.cod_art}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-col">
                        <span className="text-slate-200 font-medium text-sm leading-snug">
                          {item.descripcion}
                        </span>
                        {item.descripcion_adicional && (
                          <span className="text-xs text-slate-500 italic mt-0.5 leading-snug">
                            {item.descripcion_adicional}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-400 whitespace-nowrap">
                      {item.familia || '-'}
                    </td>
                    <td className="px-4 py-3 text-right text-xs text-slate-400 font-mono whitespace-nowrap">
                      {item.fecha_ult_compra || '-'}
                    </td>
                    <td className="px-4 py-3 text-right text-xs text-slate-400 whitespace-nowrap">
                      {formatCurrency(item.costo_unit)}
                    </td>

                    {/* Celdas Dinámicas de Sucursales */}
                    {allSucursales.map(suc => (
                      <td key={suc} className="px-4 py-3 text-right font-mono text-xs text-slate-300 border-l border-border-dark/50 whitespace-nowrap">
                        {(item.sucursales[suc] || 0) === 0 ? (
                          <span className="text-slate-800">0.0</span>
                        ) : (
                          item.sucursales[suc].toLocaleString('es-AR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })
                        )}
                      </td>
                    ))}

                    {/* Columna Total General x Artículo */}
                    <td className="px-4 py-3 text-right text-emerald-400 font-bold border-l border-emerald-500/20 bg-emerald-500/5 whitespace-nowrap">
                      {item.stock_total.toLocaleString('es-AR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}
                    </td>

                    {/* Columna Venta Promedio */}
                    <td className="px-4 py-3 text-right text-orange-400 font-bold border-l border-orange-500/20 bg-orange-500/5 whitespace-nowrap tabular-nums">
                      {statValue.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </td>

                    {/* Columna Cobertura (Semáforo) */}
                    <td className={`px-4 py-3 text-right font-bold border-l border-slate-700/50 whitespace-nowrap tabular-nums
                      ${coverageStatus === 'low' ? 'bg-rose-500/10 text-rose-500 animate-pulse' : 
                        coverageStatus === 'high' ? 'text-amber-400' : 
                        coverageStatus === 'none' ? 'text-slate-700 font-normal italic' : 'text-slate-300'}
                    `}>
                      {coverageStatus === 'none' ? 'Sin ventas' : `${diasCobertura} días`}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
          {data.length > 0 && (
            <tfoot className="sticky bottom-0 z-20">
              <tr className="bg-[#0f172a] border-t-2 border-primary/60">
                <td
                  colSpan={5}
                  className="px-4 py-3 text-right text-xs font-bold text-slate-300 tracking-widest uppercase whitespace-nowrap"
                >
                  TOTALES POR SUCURSAL
                </td>
                
                {allSucursales.map(suc => (
                  <td key={suc} className="px-4 py-3 text-right whitespace-nowrap border-l border-primary/20">
                    <span className="block font-bold text-primary text-xs tabular-nums">
                      {branchTotals[suc].toLocaleString('es-AR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}
                    </span>
                  </td>
                ))}

                <td className="px-4 py-3 text-right whitespace-nowrap border-l border-emerald-500/40 bg-emerald-500/10">
                  <span className="block font-bold text-emerald-400 text-sm tabular-nums">
                    {grandTotal.toLocaleString('es-AR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}
                  </span>
                </td>

                <td className="px-4 py-3 text-right whitespace-nowrap border-l border-orange-500/40 bg-orange-500/10">
                  {/* Empty cell for Venta Promedio */}
                </td>

                <td className="px-4 py-3 text-right whitespace-nowrap border-l border-slate-700 bg-slate-800/20">
                  {/* Empty cell for Cobertura */}
                </td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
  );
};
