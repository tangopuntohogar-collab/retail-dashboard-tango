import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Sidebar } from './components/Sidebar';
import { Header } from './components/Header';
import { DashboardView } from './components/DashboardView';
import { SalesTable } from './components/SalesTable';
import { StockView } from './components/StockView';
import { FilterSidebar } from './components/FilterSidebar';
import { VentaRow, VentasFilters, DetailFilterOptions, getInitialFilters, DashboardMetrics } from './types';
import {
  fetchVentas, fetchVentasAgregadas, fetchVentasAgregadasPrevio, PAGE_SIZE,
  fetchFilterOptions, getMediosPagoFromCache, fetchTopClientes, fetchCuotas,
  fetchTipos, fetchGeneros, fetchProveedores,
  DateRange,
} from './lib/salesService';
import { motion, AnimatePresence } from 'motion/react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

const EMPTY_DETAIL_OPTIONS: DetailFilterOptions = {
  sucursales: [], rubros: [], mediosPago: [], cuentas: [], clientes: [], cuotas: [],
  familias: [], categorias: [], tipos: [], generos: [], proveedores: [],
};

export default function App() {
  const [activeView, setActiveView] = useState<'dashboard' | 'detail' | 'stock'>('dashboard');
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);

  // ── States independientes para Dashboard ──────────────────────────────────
  const [dashFilters, setDashFilters] = useState<VentasFilters>(getInitialFilters());
  const [dashOptions, setDashOptions] = useState<DetailFilterOptions>(EMPTY_DETAIL_OPTIONS);
  const [isLoadingDashOptions, setIsLoadingDashOptions] = useState(true);

  // ── States independientes para Detalle ─────────────────────────────────────
  const [detailFilters, setDetailFilters] = useState<VentasFilters>(getInitialFilters());
  const [detailOptions, setDetailOptions] = useState<DetailFilterOptions>(EMPTY_DETAIL_OPTIONS);
  const [isLoadingDetailOptions, setIsLoadingDetailOptions] = useState(true);

  // ── Data state ────────────────────────────────────────────────────────────
  const [dashData, setDashData] = useState<DashboardMetrics | null>(null);
  const [dashPrevData, setDashPrevData] = useState<DashboardMetrics | null>(null);
  const [tableData, setTableData] = useState<VentaRow[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [totalImporteGlobal, setTotalImporteGlobal] = useState(0);
  const [currentPage, setCurrentPage] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));

  // ── Helper para cargar opciones de filtros ────────────────────────────
  // Usa /api/ventas/options para obtener DISTINCT values en una sola llamada SQL.
  const loadOptions = async (filters: VentasFilters, setOptions: (o: DetailFilterOptions) => void, setLoading: (b: boolean) => void) => {
    const range: DateRange = { fechaDesde: filters.fechaDesde, fechaHasta: filters.fechaHasta };
    setLoading(true);
    try {
      // Una sola llamada al servidor en vez de 9 fetches paralelos
      const [opts, clientes, cuotas, tipos, generos, proveedores] = await Promise.all([
        fetchFilterOptions(range),
        fetchTopClientes(range),
        fetchCuotas(range),
        fetchTipos(range),
        fetchGeneros(range),
        fetchProveedores(filters),
      ]);
      setOptions({
        sucursales: opts.sucursales,
        rubros:     [],              // no existe en esta vista, queda vacío
        mediosPago: opts.mediosPago,
        familias:   opts.familias,
        categorias: opts.categorias,
        cuentas:    [],
        clientes,
        cuotas,
        tipos,
        generos,
        proveedores,
      });
    } catch (e) {
      console.error('Error cargando opciones:', e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadOptions(dashFilters, setDashOptions, setIsLoadingDashOptions); }, [dashFilters.fechaDesde, dashFilters.fechaHasta]);
  useEffect(() => { loadOptions(detailFilters, setDetailOptions, setIsLoadingDetailOptions); }, [detailFilters.fechaDesde, detailFilters.fechaHasta]);

  // ── Reset en cascada: si el período cambia y algún medioPago seleccionado ya no ──
  // ── existe en las opciones del nuevo período, se elimina del filtro activo.    ──
  useEffect(() => {
    if (!dashOptions.mediosPago.length || !dashFilters.mediosPago.length) return;
    const disponibles = new Set(dashOptions.mediosPago);
    const aun_validos = dashFilters.mediosPago.filter(mp => disponibles.has(mp));
    if (aun_validos.length !== dashFilters.mediosPago.length) {
      console.log('[App] Reseteando mediosPago del Dashboard:', dashFilters.mediosPago, '→', aun_validos);
      setDashFilters(f => ({ ...f, mediosPago: aun_validos }));
    }
  }, [dashOptions.mediosPago]);

  useEffect(() => {
    if (!detailOptions.mediosPago.length || !detailFilters.mediosPago.length) return;
    const disponibles = new Set(detailOptions.mediosPago);
    const aun_validos = detailFilters.mediosPago.filter(mp => disponibles.has(mp));
    if (aun_validos.length !== detailFilters.mediosPago.length) {
      console.log('[App] Reseteando mediosPago del Detalle:', detailFilters.mediosPago, '→', aun_validos);
      setDetailFilters(f => ({ ...f, mediosPago: aun_validos }));
    }
  }, [detailOptions.mediosPago]);

  // ── useMemo: opciones de medioPago derivadas del cache (síncrono) ──────────
  // Cuando el cache para el período ya está cargado, esto re-calcula sin fetch.
  // Complementa a loadOptions (asíncrono) como una versión instánea y reactiva.
  const dashMediosPagoMemo = useMemo(
    () => getMediosPagoFromCache(dashFilters.fechaDesde, dashFilters.fechaHasta),
    [dashFilters.fechaDesde, dashFilters.fechaHasta, dashOptions.mediosPago]
  );
  const detailMediosPagoMemo = useMemo(
    () => getMediosPagoFromCache(detailFilters.fechaDesde, detailFilters.fechaHasta),
    [detailFilters.fechaDesde, detailFilters.fechaHasta, detailOptions.mediosPago]
  );

  // Merge: preferimos el resultado del useMemo (más fresco) si está disponible
  const dashOptionsEfectivas: DetailFilterOptions = useMemo(() => ({
    ...dashOptions,
    mediosPago: dashMediosPagoMemo.length ? dashMediosPagoMemo : dashOptions.mediosPago,
  }), [dashOptions, dashMediosPagoMemo]);

  const detailOptionsEfectivas: DetailFilterOptions = useMemo(() => ({
    ...detailOptions,
    mediosPago: detailMediosPagoMemo.length ? detailMediosPagoMemo : detailOptions.mediosPago,
  }), [detailOptions, detailMediosPagoMemo]);

  // ── Load dashboard (aggregated) ───────────────────────────────────────────
  const loadDashboardData = useCallback(async (f: VentasFilters) => {
    console.log('[App] loadDashboardData - Calling with:', f);
    try {
      const [rows, prevRows] = await Promise.all([
        fetchVentasAgregadas(f),
        fetchVentasAgregadasPrevio(f),
      ]);
      console.log(`[App] loadDashboardData - Received aggregated data:`, rows.kpis);
      setDashData(rows);
      setDashPrevData(prevRows);
      setError(null);
    } catch (e: any) {
      console.error('Dashboard error:', e);
      setError(e?.message ?? 'Error al cargar el tablero');
    }
  }, []);

  // ── Load table (paginated) ────────────────────────────────────────────────
  const loadTableData = useCallback(async (f: VentasFilters, page: number) => {
    console.log(`[App] loadTableData - Calling page ${page} with:`, f);
    try {
      const { data, count, totalImporteGlobal: tig } = await fetchVentas(f, page * PAGE_SIZE);
      console.log(`[App] loadTableData - Received ${data.length} rows, total count: ${count}, totalImporte: ${tig}`);
      setTableData(data);
      setTotalCount(count);
      setTotalImporteGlobal(tig);
      setError(null);
    } catch (e: any) {
      console.error('Table error:', e);
      setError(e?.message ?? 'Error al cargar el detalle');
    }
  }, []);

  // ── React to filter changes ───────────────────────────────────────────────
  useEffect(() => {
    console.log('[App] useEffect dashFilters triggered:', dashFilters);
    setIsLoading(true);
    loadDashboardData(dashFilters).finally(() => setIsLoading(false));
  // Re-fetcha cuando cambia cualquier filtro que el servidor ahora maneja
  }, [dashFilters.fechaDesde, dashFilters.fechaHasta,
      dashFilters.mediosPago, dashFilters.familias, dashFilters.categorias,
      dashFilters.sucursales]);

  useEffect(() => {
    console.log('[App] useEffect detailFilters triggered:', detailFilters);
    setCurrentPage(0);
    setIsLoading(true);
    loadTableData(detailFilters, 0).finally(() => setIsLoading(false));
  }, [detailFilters]);

  useEffect(() => {
    if (currentPage === 0) return;
    setIsLoading(true);
    loadTableData(detailFilters, currentPage).finally(() => setIsLoading(false));
  }, [currentPage]);

  const handleViewChange = (view: 'dashboard' | 'detail' | 'stock') => {
    setActiveView(view);
    setIsSidebarCollapsed(view === 'detail' || view === 'stock');
  };

  const handlePageChange = (delta: number) =>
    setCurrentPage(p => Math.min(Math.max(0, p + delta), totalPages - 1));

  const pageFrom = currentPage * PAGE_SIZE + 1;
  const pageTo = Math.min((currentPage + 1) * PAGE_SIZE, totalCount);

  return (
    <div className="flex h-screen w-full relative overflow-hidden bg-surface-dark">
      {/* Main nav sidebar */}
      <Sidebar
        activeView={activeView}
        onViewChange={handleViewChange}
        isCollapsed={isSidebarCollapsed}
        onToggleCollapse={() => setIsSidebarCollapsed(!isSidebarCollapsed)}
      />

      <main className="flex-1 flex flex-col h-full overflow-hidden relative">
        <Header
          title={
            activeView === 'dashboard'
              ? 'Tablero General'
              : activeView === 'detail'
                ? 'Detalle de Ventas'
                : 'Análisis de Stock'
          }
          subtitle={
            activeView === 'dashboard'
              ? 'Operaciones Diarias > Vista Dashboard'
              : activeView === 'detail'
                ? 'Operaciones Diarias > Vista Grilla'
                : 'Operaciones Diarias > Análisis de Inventario'
          }
          isLoading={isLoading}
          error={error}
          detailFilters={activeView === 'detail' ? detailFilters : undefined}
          totalCount={activeView === 'detail' ? totalCount : undefined}
        />

        <div className="flex-1 overflow-hidden relative w-full flex flex-col">
          <AnimatePresence mode="wait">

            {/* ── Dashboard View ─────────────────────────────────────────── */}
            {activeView === 'dashboard' && (
              <motion.div
                key="dashboard"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                transition={{ duration: 0.2 }}
                className="h-full"
              >
                <div className="h-full flex overflow-hidden">
                  <FilterSidebar
                    filters={dashFilters}
                    onFiltersChange={setDashFilters}
                    options={dashOptionsEfectivas}
                    isLoadingOptions={isLoadingDashOptions}
                  />
                  <div className="flex-1 overflow-auto">
                    <DashboardView data={dashData} prevData={dashPrevData} filters={dashFilters} isLoading={isLoading} />
                  </div>
                </div>
              </motion.div>
            )}

            {/* ── Detail View ────────────────────────────────────────────── */}
            {activeView === 'detail' && (
              <motion.div
                key="detail"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                transition={{ duration: 0.2 }}
                className="h-full flex"
              >
                {/* Filter sidebar dedicated to the detail view */}
                <FilterSidebar
                  filters={detailFilters}
                  onFiltersChange={setDetailFilters}
                  options={detailOptionsEfectivas}
                  isLoadingOptions={isLoadingDetailOptions}
                />

                {/* Table + pagination */}
                <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
                  <SalesTable data={tableData} isLoading={isLoading} totalImporteGlobal={totalImporteGlobal} />

                  {/* Pagination Footer */}
                  <div className="h-14 border-t border-border-dark bg-[#0f172a] shrink-0 flex items-center justify-between px-6 z-20">
                    <div className="text-xs text-slate-400">
                      {isLoading
                        ? 'Cargando datos...'
                        : totalCount === 0
                          ? 'Sin registros para los filtros seleccionados'
                          : (
                            <>
                              Mostrando{' '}
                              <span className="font-medium text-white">{pageFrom}</span>
                              {' – '}
                              <span className="font-medium text-white">{pageTo}</span>
                              {' de '}
                              <span className="font-medium text-white">
                                {totalCount.toLocaleString('es-AR')}
                              </span>
                              {' registros'}
                            </>
                          )
                      }
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-slate-400 mr-2">
                        Pág. {currentPage + 1} / {totalPages}
                      </span>
                      <div className="flex items-center rounded-md border border-border-dark bg-[#020617] overflow-hidden">
                        <button
                          onClick={() => handlePageChange(-1)}
                          disabled={currentPage === 0 || isLoading}
                          className="px-3 py-1.5 text-slate-500 hover:bg-slate-800 hover:text-white transition-colors disabled:opacity-50"
                        >
                          <ChevronLeft size={16} />
                        </button>
                        <div className="w-px h-4 bg-border-dark" />
                        <button
                          onClick={() => handlePageChange(1)}
                          disabled={currentPage >= totalPages - 1 || isLoading}
                          className="px-3 py-1.5 text-slate-500 hover:bg-slate-800 hover:text-white transition-colors disabled:opacity-50"
                        >
                          <ChevronRight size={16} />
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              </motion.div>
            )}

            {/* ── Stock View ────────────────────────────────────────────── */}
            {activeView === 'stock' && (
              <motion.div
                key="stock"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                transition={{ duration: 0.2 }}
                className="h-full flex-1 min-h-0"
              >
                <StockView 
                  options={detailOptionsEfectivas} 
                  isLoadingOptions={isLoadingDetailOptions} 
                />
              </motion.div>
            )}

          </AnimatePresence>
        </div>
      </main>
    </div>
  );
}
