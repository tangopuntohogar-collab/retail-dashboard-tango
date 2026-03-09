import React from 'react';
import { StockRow } from '../types';
import { Loader2 } from 'lucide-react';

interface StockTableProps {
  data: StockRow[];
  isLoading: boolean;
  selectedSucursal?: string | null;
}

export const StockTable: React.FC<StockTableProps> = ({ data, isLoading, selectedSucursal }) => {

  const formatCurrency = (val: number | null) =>
    new Intl.NumberFormat('es-AR', {
      style: 'currency',
      currency: 'ARS',
      minimumFractionDigits: 2,
    }).format(val ?? 0);

  const totalSaldo = data.reduce((acc, r) => acc + (r.saldo ?? 0), 0);
  
  // Subtotal por sucursal si hay una seleccionada
  const subtotalSucursal = selectedSucursal 
    ? data.filter(r => r.nro_sucursal === selectedSucursal).reduce((acc, r) => acc + (r.saldo ?? 0), 0)
    : null;

  const COL_COUNT = 11;

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
      <table className="w-full text-left text-sm text-slate-400 border-collapse">
        <thead className="bg-[#0f172a] text-xs uppercase font-semibold text-slate-300 sticky top-0 z-20 border-b border-border-dark shadow-sm">
          <tr>
            <th className="px-4 py-3.5 w-[55px] whitespace-nowrap">Suc.</th>
            <th className="px-4 py-3.5 w-[105px] whitespace-nowrap">Cód. Art.</th>
            <th className="px-4 py-3.5 min-w-[220px]">Descripción</th>
            <th className="px-4 py-3.5 min-w-[120px]">Familia</th>
            <th className="px-4 py-3.5 min-w-[120px]">Categoría</th>
            <th className="px-4 py-3.5 min-w-[100px]">Tipo Art.</th>
            <th className="px-3 py-3 text-left text-[10px] font-semibold text-slate-400 uppercase tracking-wider">Género</th>
            <th className="px-3 py-3 text-left text-[10px] font-semibold text-slate-400 uppercase tracking-wider">Proveedor</th>
            <th className="px-3 py-3 text-right text-[10px] font-semibold text-slate-400 uppercase tracking-wider">Últ. Compra</th>
            <th className="px-3 py-3 text-right text-[10px] font-semibold text-slate-400 uppercase tracking-wider">Costo Unit.</th>
            <th className="px-3 py-3 text-right text-[10px] font-semibold text-slate-400 uppercase tracking-wider">Saldo</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border-dark bg-[#020617]">
          {!isLoading && data.length === 0 ? (
            <tr>
              <td colSpan={COL_COUNT} className="px-5 py-12 text-center text-slate-500">
                No se encontraron saldos de stock para los filtros seleccionados.
              </td>
            </tr>
          ) : (
            data.map((item, i) => (
              <tr
                key={i}
                className="hover:bg-slate-800/40 transition-colors group border-b border-border-dark last:border-0"
              >
                <td className="px-4 py-3 text-slate-300 font-mono text-xs font-semibold">
                  {item.nro_sucursal}
                </td>
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
                <td className="px-4 py-3 text-xs text-slate-400 whitespace-nowrap">
                  {item.categoria || '-'}
                </td>
                <td className="px-4 py-3 text-xs text-slate-400 whitespace-nowrap">
                  {item.tipo_art || '-'}
                </td>
                <td className="px-4 py-3 text-xs text-slate-400 whitespace-nowrap">
                  {item.genero || '-'}
                </td>
                <td className="px-4 py-3 text-xs text-slate-400 whitespace-nowrap">
                  {item.proveedor || '-'}
                </td>
                <td className="px-4 py-3 text-right text-xs text-slate-400 font-mono whitespace-nowrap">
                  {item.fecha_ult_compra || '-'}
                </td>
                <td className="px-4 py-3 text-right text-xs text-slate-400 whitespace-nowrap">
                  {formatCurrency(item.costo_unit)}
                </td>
                <td className="px-4 py-3 text-right text-slate-200 font-semibold whitespace-nowrap">
                  {Number(item.saldo).toLocaleString('es-AR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}
                </td>
              </tr>
            ))
          )}
        </tbody>
        {data.length > 0 && (
          <tfoot className="sticky bottom-0 z-20">
            <tr className="bg-[#0f172a] border-t-2 border-primary/60">
              <td
                colSpan={10}
                className="px-4 py-3 text-right text-xs font-bold text-slate-300 tracking-widest uppercase whitespace-nowrap"
              >
                <span>Total General Stock</span>
                {subtotalSucursal !== null && (
                  <span className="block text-[10px] text-slate-500 lowercase font-normal tracking-normal mt-0.5">
                    Subtotal Suc. {selectedSucursal}: {subtotalSucursal.toLocaleString('es-AR')}
                  </span>
                )}
              </td>
              <td className="px-4 py-3 text-right whitespace-nowrap">
                <span className="block font-bold text-emerald-400 text-sm tabular-nums">
                  {totalSaldo.toLocaleString('es-AR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}
                </span>
              </td>
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  );
};
