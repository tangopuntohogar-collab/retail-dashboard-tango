import React, { useState, useEffect, useMemo } from 'react';
import { StockMatrixRow, StockFilters, DetailFilterOptions, getInitialStockFilters } from '../types';
import { fetchStock } from '../lib/stockService';
import { StockTable } from './StockTable';
import { FilterSidebar } from './FilterSidebar';

export const StockView: React.FC = () => {
  const [rawData, setRawData] = useState<StockMatrixRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [filters, setFilters] = useState<StockFilters>(getInitialStockFilters());

  const loadStock = async () => {
    setIsLoading(true);
    try {
      const stock = await fetchStock(filters);
      setRawData(stock);
    } catch (e) {
      console.error('Error loading stock:', e);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadStock();
  }, [filters.sucursales, filters.fechaDesde, filters.fechaHasta]);

  // ── Extraer opciones únicas del inventario cargado ──────────────────────────
  const stockOptions = useMemo((): DetailFilterOptions => {
    const families = new Set<string>();
    const categories = new Set<string>();
    const types = new Set<string>();
    const genders = new Set<string>();
    const providers = new Set<string>();
    const stores = new Set<string>();

    rawData.forEach(item => {
      if (item.familia) families.add(item.familia);
      if (item.categoria) categories.add(item.categoria);
      if (item.tipo_art) types.add(item.tipo_art);
      if (item.genero) genders.add(item.genero);
      if (item.proveedor) providers.add(item.proveedor);
      Object.keys(item.sucursales).forEach(s => stores.add(s));
    });

    return {
      sucursales: Array.from(stores).sort(),
      rubros: [],
      mediosPago: [],
      cuentas: [],
      clientes: [],
      cuotas: [],
      familias: Array.from(families).sort(),
      categorias: Array.from(categories).sort(),
      tipos: Array.from(types).sort(),
      generos: Array.from(genders).sort(),
      proveedores: Array.from(providers).sort(),
    };
  }, [rawData]);

  // ── Aplicar filtros locales ────────────────────────────────────────────────
  const filteredData = useMemo(() => {
    return rawData.filter(item => {
      if (filters.familias.length && !filters.familias.includes(item.familia)) return false;
      if (filters.categorias.length && !filters.categorias.includes(item.categoria)) return false;
      if (filters.tipos.length && !filters.tipos.includes(item.tipo_art)) return false;
      if (filters.generos.length && !filters.generos.includes(item.genero)) return false;
      if (filters.proveedores.length && !filters.proveedores.includes(item.proveedor)) return false;
      
      if (filters.search) {
        const s = filters.search.toLowerCase();
        return item.descripcion.toLowerCase().includes(s) || item.cod_art.toLowerCase().includes(s);
      }
      
      return true;
    });
  }, [rawData, filters]);

  return (
    <div className="h-full flex overflow-hidden">
      <FilterSidebar
        filters={filters as any}
        onFiltersChange={setFilters}
        options={stockOptions}
        isLoadingOptions={isLoading}
        isLoading={isLoading}
        applyMode="manual"
        hideDateRange={false}
        view="stock"
      />
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <StockTable 
          data={filteredData} 
          isLoading={isLoading} 
          fechaDesde={filters.fechaDesde}
          fechaHasta={filters.fechaHasta}
          statsSucursal={filters.sucursales.length === 1 ? filters.sucursales[0] : '1001'}
        />
      </div>
    </div>
  );
};
