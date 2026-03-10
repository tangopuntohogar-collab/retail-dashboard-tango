import React, { useState } from 'react';
import { Download, Bell, Database, AlertCircle, FileSpreadsheet, Loader2 } from 'lucide-react';
import * as XLSX from 'xlsx';
import { VentasFilters } from '../types';

const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:3002/api/ventas';
const BASE_URL = API_URL.replace('/api/ventas', '');

interface HeaderProps {
  title: string;
  subtitle?: string;
  isLoading?: boolean;
  error?: string | null;
  /** Filtros activos de la vista de detalle — para exportar con los mismos parámetros */
  detailFilters?: VentasFilters;
  /** Total de registros filtrados (para el título del botón) */
  totalCount?: number;
}

/**
 * Llama a /api/ventas/exportar con los filtros activos y genera un .xlsx con autosuma.
 * Timeout extendido a 3 min para períodos amplios.
 */
async function exportarExcel(filters: VentasFilters, onProgress?: (msg: string) => void): Promise<void> {
  const params = new URLSearchParams();
  if (filters.fechaDesde) params.set('desde', filters.fechaDesde);
  if (filters.fechaHasta) params.set('hasta', filters.fechaHasta);
  if (filters.mediosPago?.length === 1) params.set('medioPago', filters.mediosPago[0]);
  if (filters.familias?.length   === 1) params.set('familia',   filters.familias[0]);
  if (filters.categorias?.length === 1) params.set('categoria', filters.categorias[0]);
  filters.sucursales?.forEach(s => params.append('sucursal', String(s)));

  const url = `${BASE_URL}/api/ventas/exportar?${params}`;
  onProgress?.(`Descargando datos del servidor (puede tardar 20-60 seg para períodos amplios)...`);

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 3 * 60 * 1000); // 3 min

  let json: { data: any[]; total: number };
  try {
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timeoutId);
    if (!res.ok) throw new Error(`Error del servidor: ${res.status}`);
    json = await res.json();
  } catch (err: any) {
    clearTimeout(timeoutId);
    if (err.name === 'AbortError') throw new Error('La descarga tardó más de 3 minutos y fue cancelada.');
    throw err;
  }

  const rows = json.data ?? [];
  onProgress?.(`Generando Excel con ${rows.length} registros...`);

  // ── Encabezados (21 columnas para coincidir con SalesTable.tsx) ──────────
  const HEADERS = [
    'Sucursal', 'Tipo', 'Comprobante', 'Fecha',
    'Familia', 'Categoría', 'Tipo Art.', 'Género', 'Proveedor',
    'Cód. Art.', 'Descripción', 'Cliente', 'Rubro',
    'Medio de Pago', 'Cuotas',
    'Cant.', 'Precio Neto', 'Precio Unit.', 'Total c/IVA',
    'Costo Unit.', 'Rentab.'
  ];

  const formatDate = (dateString: string) => {
    if (!dateString) return '';
    const iso = dateString.split('T')[0];
    const [year, month, day] = iso.split('-');
    if (!year || !month || !day) return '';
    return `${day}/${month}/${year}`;
  };

  // ── Datos (21 campos mapeados) ───────────────────────────────────────────
  const dataRows = rows.map((r: any) => {
    // Total c/IVA — fuente de verdad (imp_prop_c_iva es el alias usado en SQL)
    const impProp = Number(r['Total cIVA'] ?? r['imp_prop_c_iva'] ?? 0);
    const cant = Number(r['Cantidad'] ?? 0);
    const pUnit = r['Precio Unitario'] != null ? Number(r['Precio Unitario']) : (cant > 0 ? impProp / cant : 0);
    
    // Costo — se busca en 'costo' o en el alias 'CostoUnitario' de SQL
    const costo = r['costo'] != null ? Number(r['costo']) : (r['CostoUnitario'] != null ? Number(r['CostoUnitario']) : 0);
    
    // Rentabilidad DINÁMICA: ((P.Unit - Costo) / Costo) * 100
    // Si el costo es <= 0, la rentabilidad es 0 para evitar errores
    const rentabilidad = (costo > 0) ? ((pUnit - costo) / costo) * 100 : 0;

    return [
      r['Nro. Sucursal'] ?? '',
      r['Tipo de comprobante'] ?? '', // t_comp
      r['Nro. Comprobante'] ?? '',    // n_comp
      formatDate(r['Fecha'] ?? ''),
      r['Familia'] ?? '-',
      r['Categoria'] ?? '-',
      r['tipo'] ?? '-',
      r['genero'] ?? '-',
      r['PROVEEDOR (Adic.)'] ?? r['proveedor'] ?? '-',
      r['Cód. Artículo'] ?? '',
      (r['Descripción'] ?? '') + (r['desc_adic'] ? ` (${r['desc_adic']})` : ''),
      (r['razon_social'] ?? '-') + (r['cod_client'] ? ` [${r['cod_client']}]` : ''),
      r['rubro'] ?? '-',
      r['Medio de Pago'] ?? '-',
      r['cant_cuotas'] ? `${r['cant_cuotas']}c` : '-',
      cant,
      r['Precio Neto'] != null ? Number(r['Precio Neto']) : '',
      pUnit,
      impProp,
      costo > 0 ? costo : '',
      rentabilidad.toFixed(2) + '%'
    ];
  });

  // ── Fila de autosuma en la última fila ────────────────────────────────────
  const dataStart = 2;                      // fila 1 = encabezados, fila 2..N = datos
  const dataEnd   = dataRows.length + 1;    // última fila de datos (1-indexed)
  const totalRow  = dataRows.length + 2;    // fila del total (debajo de los datos)

  // Col 19 = S: Suc(1)|Tipo(2)|Comp(3)|Fech(4)|Fam(5)|Cat(6)|TArt(7)|Gen(8)|Prov(9)|Cód(10)|Desc(11)|Clie(12)|Rub(13)|MP(14)|Cuo(15)|Cant(16)|PNet(17)|PUni(18)|Total(19)
  const TOTAL_COL = 'S';
  const sumaFormula = `SUM(${TOTAL_COL}${dataStart}:${TOTAL_COL}${dataEnd})`;

  const footerRow = [
    'TOTAL GENERAL', '', '', '',
    '', '', '', '', '', // Fam a Prov (5-9)
    '', '', '', '',    // Cód a Rub (10-13)
    '', '',            // MP, Cuotas (14-15)
    '',                // Cant (16)
    '',                // P.Neto (17)
    '',                // P.Unit (18)
    { t: 'n', f: sumaFormula }, // Total c/IVA (19 - S)
    '',                // Costo
    ''                 // Rentab
  ];

  // ── Armar el worksheet ────────────────────────────────────────────────────
  const wsData = [HEADERS, ...dataRows, footerRow];
  const ws     = XLSX.utils.aoa_to_sheet(wsData);

  // ── Ancho de columnas (21) ───────────────────────────────────────────────
  ws['!cols'] = [
    { wch: 8 },  // Sucursal
    { wch: 6 },  // Tipo
    { wch: 18 }, // Comprobante
    { wch: 12 }, // Fecha
    { wch: 15 }, // Familia
    { wch: 15 }, // Categoría
    { wch: 15 }, // Tipo Art.
    { wch: 12 }, // Género
    { wch: 25 }, // Proveedor
    { wch: 12 }, // Cód. Art.
    { wch: 45 }, // Descripción
    { wch: 30 }, // Cliente
    { wch: 15 }, // Rubro
    { wch: 25 }, // Medio de Pago
    { wch: 8 },  // Cuotas
    { wch: 8 },  // Cantidad
    { wch: 14 }, // Precio Neto
    { wch: 14 }, // Precio Unit.
    { wch: 16 }, // Total c/IVA (Col S)
    { wch: 14 }, // Costo Unit.
    { wch: 10 }, // Rentab.
  ];

  // ── Nombre de archivo con período activo ─────────────────────────────────
  const desde  = filters.fechaDesde?.replace(/-/g, '') ?? 'inicio';
  const hasta  = filters.fechaHasta?.replace(/-/g, '') ?? 'fin';
  const nombre = `ventas_${desde}_${hasta}.xlsx`;

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Ventas');
  XLSX.writeFile(wb, nombre);
}

export const Header: React.FC<HeaderProps> = ({
  title, subtitle, isLoading, error, detailFilters, totalCount,
}) => {
  const [isExporting, setIsExporting] = useState(false);
  const [exportMsg,   setExportMsg]   = useState<string | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);

  const handleExport = async () => {
    if (!detailFilters || isExporting) return;
    setIsExporting(true);
    setExportError(null);
    setExportMsg(null);
    try {
      await exportarExcel(detailFilters, setExportMsg);
      setExportMsg('✅ Archivo generado correctamente.');
      setTimeout(() => setExportMsg(null), 4000);
    } catch (e: any) {
      setExportError(e?.message ?? 'Error al exportar');
      setTimeout(() => setExportError(null), 6000);
    } finally {
      setIsExporting(false);
    }
  };

  const totalLabel = totalCount != null && totalCount > 0
    ? `Exportar ${totalCount.toLocaleString('es-AR')} registros`
    : 'Exportar a Excel';

  return (
    <header className="h-16 border-b border-border-dark bg-[#0f172a]/95 backdrop-blur z-10 flex items-center justify-between px-8 shrink-0">
      <div className="flex items-center gap-4">
        <div className="flex flex-col">
          <h2 className="text-xl font-bold text-white tracking-tight">{title}</h2>
          {subtitle && <p className="text-xs text-slate-400">{subtitle}</p>}
        </div>

        {error ? (
          <span className="px-2 py-0.5 rounded text-xs font-medium bg-red-500/10 text-red-400 border border-red-500/20 whitespace-nowrap flex items-center gap-1">
            <AlertCircle size={13} />
            Error de conexión
          </span>
        ) : (
          <span className="px-2 py-0.5 rounded text-xs font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 whitespace-nowrap flex items-center gap-1">
            <Database size={13} />
            {isLoading ? 'Cargando...' : 'SQL Server · En vivo'}
            {!isLoading && <span className="size-1.5 rounded-full bg-emerald-400 animate-pulse ml-0.5" />}
          </span>
        )}

        {/* Mensaje de progreso / error de exportación */}
        {(exportMsg || exportError) && (
          <span className={`text-xs px-2 py-0.5 rounded border ${exportError
            ? 'bg-red-500/10 text-red-400 border-red-500/20'
            : 'bg-blue-500/10 text-blue-300 border-blue-500/20'
          } max-w-xs truncate`}>
            {exportError ?? exportMsg}
          </span>
        )}
      </div>

      <div className="flex items-center gap-4">
        <div className="h-6 w-px bg-border-dark mx-2 hidden sm:block" />

        {/* Botón exportar — solo en vista de detalle */}
        {detailFilters && (
          <button
            onClick={handleExport}
            disabled={isExporting || isLoading || !detailFilters.fechaDesde}
            title={isExporting ? 'Generando Excel...' : totalLabel}
            className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-primary hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-medium transition-colors shadow-lg shadow-blue-500/20 whitespace-nowrap"
          >
            {isExporting ? (
              <>
                <Loader2 size={16} className="animate-spin" />
                Generando…
              </>
            ) : (
              <>
                <FileSpreadsheet size={16} />
                {totalLabel}
              </>
            )}
          </button>
        )}

        {/* Si no hay filtros de detalle, no mostramos el botón */}
        {!detailFilters && (
          <button
            disabled
            className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-primary/40 cursor-not-allowed text-white/50 text-sm font-medium whitespace-nowrap"
          >
            <Download size={16} />
            Exportar
          </button>
        )}
      </div>
    </header>
  );
};
