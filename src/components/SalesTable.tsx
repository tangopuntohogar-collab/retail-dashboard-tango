import React from 'react';
import { VentaRow } from '../types';
import { Loader2 } from 'lucide-react';
import { isNotaCreditoTipo } from '../lib/salesService';

interface SalesTableProps {
  data: VentaRow[];
  isLoading: boolean;
  /** SUM([Total cIVA]) de TODOS los registros que coinciden con los filtros activos,
   *  independientemente de la paginación. Viene de server.ts → meta.totalImporteGlobal */
  totalImporteGlobal?: number;
}

export const SalesTable: React.FC<SalesTableProps> = ({ data, isLoading, totalImporteGlobal }) => {

  /** Formato moneda: 2 decimales + separador de miles (es-AR → 1.250.000,00) */
  const formatCurrency = (val: number | null) =>
    new Intl.NumberFormat('es-AR', {
      style: 'currency',
      currency: 'ARS',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(val ?? 0);

  const formatDate = (dateString: string) => {
    if (!dateString) return '-';
    const iso = dateString.split('T')[0];
    const [year, month, day] = iso.split('-');
    if (!year || !month || !day) return '-';
    return `${day}/${month}/${year.slice(-2)}`;
  };

  /**
   * Lógica de negocio para Medio de Pago:
   *   cod_cond_venta === 1  →  desc_cuenta  (pago contado: muestra caja/banco)
   *   cualquier otro valor  →  desc_cond_venta  (muestra condición pactada)
   */
  const getMedioPago = (row: VentaRow): string => {
    if (String(row.cod_cond_venta) === '1') return row.desc_cuenta ?? '-';
    return row.desc_cond_venta ?? '-';
  };

  /**
   * Badge para Medio de Pago: usa directamente el campo medioPago de la vista SQL.
   * Colorea según el tipo de pago detectado en el texto.
   */
  const getMedioPagoBadge = (row: VentaRow) => {
    const label = row.medioPago ?? '-';
    const lc = label.toLowerCase();

    let styles = 'bg-slate-800 text-slate-400 border-slate-700';
    if (lc.includes('efec') || lc.includes('caja') || lc.includes('contado')) {
      styles = 'bg-blue-500/10 text-blue-400 border-blue-500/20';
    } else if (lc.includes('tarj') || lc.includes('débito') || lc.includes('credito') || lc.includes('crédito')) {
      styles = 'bg-violet-500/10 text-violet-400 border-violet-500/20';
    } else if (lc.includes('cta') || lc.includes('corriente') || lc.includes('financ')) {
      styles = 'bg-orange-500/10 text-orange-400 border-orange-500/20';
    } else if (label !== '-') {
      styles = 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20';
    }

    return (
      <span className={`text-[10px] px-2 py-0.5 rounded border font-medium tracking-wide uppercase whitespace-nowrap ${styles}`}>
        {label}
      </span>
    );
  };

  const getMargenBadge = (margen: number | null) => {
    const v = margen ?? 0;
    let styles = 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20';
    if (v < 0) styles = 'text-red-400 bg-red-500/10 border-red-500/20';
    if (v === 0) styles = 'text-amber-500 bg-amber-500/10 border-amber-500/20';
    return (
      <span className={`text-xs px-2 py-0.5 rounded border font-medium inline-block min-w-[55px] text-center ${styles}`}>
        {v.toFixed(1)}%
      </span>
    );
  };

  /** Total c/IVA — fuente de verdad de facturación */
  const impProp = (row: VentaRow) => Number(row.totalIVA ?? row.imp_prop_c_iva ?? row.importe_c_iva ?? 0);

  /** Precio unitario desde el campo real de SQL, con fallback calculado */
  const precioUnitDisplay = (row: VentaRow): number => {
    if (row.precioUnitario != null) return row.precioUnitario;
    const cant = row.cantidad ?? 0;
    const imp = impProp(row);
    return cant > 0 ? imp / cant : 0;
  };

  /** Formatea n_comp manteniendo el formato original (ej. 0001-00001234) */
  const formatComp = (nComp: string | null) => nComp ?? '-';

  /** Muestra '-' si cant_cuotas es null o 0 */
  const formatCuotas = (cuotas: number | null) =>
    !cuotas ? '-' : `${cuotas}c`;

  // 21 columnas: Suc. | Tipo | Comprobante | Fecha | Familia | Cat. | Tipo Art. | Gen. | Prov | Cód.Art | Descripción | Cliente | Rubro | Medio de Pago | Cuotas | Cant. | Precio Neto | Precio Unit. | Total c/IVA | Costo Unit. | Rentab.
  const COL_COUNT = 21;

  return (
    <div className="flex-1 overflow-auto relative w-full">
      {isLoading && (
        <div className="absolute inset-0 flex items-center justify-center z-30 bg-[#020617]/80 backdrop-blur-sm">
          <div className="flex flex-col items-center gap-3">
            <Loader2 size={32} className="animate-spin text-primary" />
            <span className="text-sm text-slate-400">Cargando datos...</span>
          </div>
        </div>
      )}
      <table className="w-full text-left text-sm text-slate-400 border-collapse">
        <thead className="bg-[#0f172a] text-xs uppercase font-semibold text-slate-300 sticky top-0 z-20 border-b border-border-dark shadow-sm">
          <tr>
            {/* Trazabilidad del comprobante */}
            <th className="px-4 py-3.5 w-[55px] whitespace-nowrap">Suc.</th>
            <th className="px-4 py-3.5 w-[55px] whitespace-nowrap">Tipo</th>
            <th className="px-4 py-3.5 w-[145px] whitespace-nowrap">Comprobante</th>
            <th className="px-4 py-3.5 w-[90px] whitespace-nowrap">Fecha</th>
            {/* Nuevos campos de clasificación */}
            <th className="px-4 py-3.5 min-w-[100px] whitespace-nowrap">Familia</th>
            <th className="px-4 py-3.5 min-w-[100px] whitespace-nowrap">Categoría</th>
            <th className="px-4 py-3.5 min-w-[100px] whitespace-nowrap">Tipo Art.</th>
            <th className="px-4 py-3.5 min-w-[120px] whitespace-nowrap">Género</th>
            <th className="px-4 py-3.5 min-w-[150px] whitespace-nowrap">Proveedor</th>
            {/* Artículo — Info Adicional ahora dentro de Descripción */}
            <th className="px-4 py-3.5 w-[105px] whitespace-nowrap">Cód. Art.</th>
            <th className="px-4 py-3.5 min-w-[220px]">Descripción</th>
            {/* Cliente — cod_client ahora dentro de Cliente */}
            <th className="px-4 py-3.5 min-w-[160px]">Cliente</th>
            <th className="px-4 py-3.5 min-w-[110px]">Rubro</th>
            {/* Pago */}
            <th className="px-4 py-3.5 min-w-[140px]">Medio de Pago</th>
            <th className="px-4 py-3.5 w-[65px] text-center whitespace-nowrap">Cuotas</th>
            {/* Valores — todos alineados a la derecha */}
            <th className="px-4 py-3.5 text-right w-[65px]">Cant.</th>
            <th className="px-4 py-3.5 text-right w-[130px] whitespace-nowrap">Precio Neto</th>
            <th className="px-4 py-3.5 text-right w-[135px] whitespace-nowrap">Precio Unit.</th>
            <th className="px-4 py-3.5 text-right w-[145px] whitespace-nowrap">Total c/IVA</th>
            <th className="px-4 py-3.5 text-right w-[135px] whitespace-nowrap">Costo Unit.</th>
            <th className="px-4 py-3.5 text-right w-[95px]">Rentab.</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border-dark bg-[#020617]">
          {!isLoading && data.length === 0 ? (
            <tr>
              <td colSpan={COL_COUNT} className="px-5 py-12 text-center text-slate-500">
                No se encontraron registros para los filtros seleccionados.
              </td>
            </tr>
          ) : (
            data.map((item, i) => (
              <tr
                key={i}
                className="hover:bg-slate-800/40 transition-colors group border-b border-border-dark last:border-0"
              >
                {/* Suc. */}
                <td className="px-4 py-3 text-slate-300 font-mono text-xs font-semibold">
                  {item.nro_sucursal}
                </td>

                {/* Tipo (t_comp) */}
                <td className="px-4 py-3 font-mono text-xs text-slate-400 whitespace-nowrap">
                  {item.t_comp ?? '-'}
                </td>

                {/* Comprobante (n_comp) — mantiene formato 0001-00001234 */}
                <td className="px-4 py-3 font-mono text-xs text-slate-300 whitespace-nowrap tracking-wide">
                  {formatComp(item.n_comp)}
                </td>

                {/* Fecha */}
                <td className="px-4 py-3 text-xs text-slate-400 whitespace-nowrap">
                  {formatDate(item.fecha)}
                </td>

                {/* Familia */}
                <td className="px-4 py-3 text-xs text-slate-400 whitespace-nowrap">
                  {item.familia ?? '-'}
                </td>

                {/* Categoría */}
                <td className="px-4 py-3 text-xs text-slate-400 whitespace-nowrap">
                  {item.categoria ?? '-'}
                </td>

                {/* Tipo */}
                <td className="px-4 py-3 text-xs text-slate-400 whitespace-nowrap">
                  {item.tipo ?? '-'}
                </td>

                {/* Género */}
                <td className="px-4 py-3 text-xs text-slate-400 whitespace-nowrap">
                  {item.genero ?? '-'}
                </td>

		{/* Proveedor */}
                <td className="px-4 py-3 text-xs text-slate-400 whitespace-nowrap">
                  {item.proveedor ?? '-'}
                </td>

                {/* Cód. Artículo */}
                <td className="px-4 py-3 font-mono text-xs text-slate-400 whitespace-nowrap">
                  {item.cod_articu}
                </td>

                {/* Descripción + Info Adicional (desc_adic) combinadas */}
                <td className="px-4 py-3">
                  <div className="flex flex-col">
                    <span className="text-slate-200 font-medium text-sm leading-snug">
                      {item.descripcio ?? '-'}
                    </span>
                    {item.descripcion_adicional && (
                      <span className="text-xs text-slate-500 italic mt-0.5 leading-snug">
                        {item.descripcion_adicional}
                      </span>
                    )}
                  </div>
                </td>

                {/* Cliente: razon_social + cod_client combinados */}
                <td className="px-4 py-3 max-w-[160px]">
                  <span className="block truncate text-sm text-slate-300 font-medium leading-snug" title={item.razon_social ?? ''}>
                    {item.razon_social ?? '-'}
                  </span>
                  {item.cod_client && (
                    <span className="block text-xs text-slate-500 mt-0.5 font-mono leading-snug">
                      {item.cod_client}
                    </span>
                  )}
                </td>

                {/* Rubro */}
                <td className="px-4 py-3 text-xs text-slate-400">
                  {item.rubro ?? '-'}
                </td>

                {/* Medio de Pago */}
                <td className="px-4 py-3">
                  {getMedioPagoBadge(item)}
                </td>

                {/* Cuotas — '-' si null o 0 */}
                <td className="px-4 py-3 text-center text-xs font-mono">
                  <span className={item.cant_cuotas ? 'text-slate-300 font-semibold' : 'text-slate-700'}>
                    {formatCuotas(item.cant_cuotas)}
                  </span>
                </td>

                {/* Cantidad */}
                <td className="px-4 py-3 text-right text-slate-300 font-medium font-mono text-xs">
                  {(item.cantidad ?? 0).toFixed(0)}
                </td>

                {/* Precio Neto — usa el campo real de SQL */}
                <td className="px-4 py-3 text-right text-xs text-slate-400 whitespace-nowrap">
                  {item.precioNeto != null
                    ? formatCurrency(item.precioNeto)
                    : <span className="text-slate-700">—</span>}
                </td>

                {/* Precio Unitario — usa el campo real de SQL */}
                <td className="px-4 py-3 text-right text-xs text-slate-400 whitespace-nowrap">
                  {formatCurrency(precioUnitDisplay(item))}
                </td>

                {/* Total c/IVA — campo totalIVA de SQL, formato moneda destacado */}
                <td className="px-4 py-3 text-right text-slate-200 font-semibold whitespace-nowrap">
                  {formatCurrency(impProp(item))}
                </td>

                {/* Costo unitario (= últ. precio de compra c/IVA) — 2 decimales */}
                <td className="px-4 py-3 text-right text-xs text-slate-400 whitespace-nowrap">
                  {item.costo != null ? formatCurrency(item.costo) : <span className="text-slate-700">—</span>}
                </td>

                {/* Rentabilidad — no aplica en NC (devolución) */}
                <td className="px-4 py-3 text-right">
                  {isNotaCreditoTipo(item.t_comp) || item.porcentaje_rentabilidad === null || item.porcentaje_rentabilidad === undefined ? (
                    <span className="text-slate-500">-</span>
                  ) : (
                    getMargenBadge(item.porcentaje_rentabilidad)
                  )}
                </td>
              </tr>
            ))
          )}
        </tbody>

        {/* ─── Footer de totales ────────────────── */}
        {data.length > 0 && (
          <tfoot className="sticky bottom-0 z-20">
            <tr className="bg-[#0f172a] border-t-2 border-primary/60">
              {/* Etiqueta */}
              <td
                colSpan={17}
                className="px-4 py-3 text-right text-xs font-bold text-slate-300 tracking-widest uppercase whitespace-nowrap"
              >
                <span>Total General (todos los registros filtrados)</span>
              </td>

              {/* Total c/IVA — usa el SUM global del servidor */}
              <td className="px-4 py-3 text-right whitespace-nowrap">
                <span className="block font-bold text-emerald-400 text-sm tabular-nums">
                  {formatCurrency(totalImporteGlobal ?? data.reduce((acc, r) => acc + impProp(r), 0))}
                </span>
                {/* Si hay más páginas, mostramos el subtotal de la página en texto secundario */}
                {totalImporteGlobal != null && data.length > 0 && (
                  (() => {
                    const pageSum = data.reduce((acc, r) => acc + impProp(r), 0);
                    const diff = Math.abs(totalImporteGlobal - pageSum) > 1;
                    return diff ? (
                      <span className="block text-[10px] text-slate-500 tabular-nums mt-0.5">
                        pág: {formatCurrency(pageSum)}
                      </span>
                    ) : null;
                  })()
                )}
              </td>

              {/* Columnas restantes vacías */}
              <td colSpan={3} />
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  );
};
