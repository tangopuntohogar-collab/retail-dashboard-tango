import React, { useState } from 'react';
import { Download, Database, AlertCircle, FileSpreadsheet, Loader2 } from 'lucide-react';
import { VentasFilters } from '../types';
import { getServerBaseUrl } from '../lib/apiConfig';
import { appendVentasSqlFilters } from '../lib/salesService';

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
 * Descarga el .xlsx generado en el servidor (exceljs), mismos filtros que /api/ventas.
 */
async function exportarExcel(filters: VentasFilters, onProgress?: (msg: string) => void): Promise<void> {
  const params = new URLSearchParams();
  appendVentasSqlFilters(params, filters);

  const base = getServerBaseUrl();
  const url = `${base}/api/ventas/exportar?${params}`;
  onProgress?.(`Descargando Excel del servidor (puede tardar…)...`);

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 3 * 60 * 1000);

  try {
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timeoutId);
    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Error del servidor: ${res.status} ${errText.slice(0, 120)}`);
    }
    const blob = await res.blob();
    const fname = `ventas_${new Date().toISOString().slice(0, 10)}.xlsx`;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = fname;
    a.click();
    URL.revokeObjectURL(a.href);
  } catch (err: any) {
    clearTimeout(timeoutId);
    if (err.name === 'AbortError') throw new Error('La descarga tardó más de 3 minutos y fue cancelada.');
    throw err;
  }
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
