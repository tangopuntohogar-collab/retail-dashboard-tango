import React, { useState, useEffect } from 'react';
import { StockRow, VentasFilters, DetailFilterOptions } from '../types';
import { fetchStock } from '../lib/stockService';
import { StockTable } from './StockTable';
import { FilterSidebar } from './FilterSidebar';

interface StockViewProps {
  options: DetailFilterOptions;
  isLoadingOptions: boolean;
}

export const StockView: React.FC<StockViewProps> = ({ options, isLoadingOptions }) => {
  const [data, setData] = useState<StockRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [filters, setFilters] = useState<VentasFilters>({
    fechaDesde: '',
    fechaHasta: '',
    sucursales: [],
    rubros: [],
    modalidades: [],
    mediosPago: [],
    search: '',
    cuentas: [],
    clientes: [],
    cuotas: [],
    comprobante: '',
    familias: [],
    categorias: [],
    tipos: [],
    generos: [],
    proveedores: [],
  });

  const loadStock = async () => {
    console.log('[StockView] loadStock: Initing load...');
    setIsLoading(true);
    try {
      console.log('[StockView] loadStock: Calling fetchStock with sucursales:', filters.sucursales);
      const stock = await fetchStock(filters.sucursales);
      console.log('[StockView] loadStock: Received', stock.length, 'rows');
      
      // Filtros locales para los campos adicionales
      const filtered = stock.filter(item => {
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
      
      setData(filtered);
    } catch (e) {
      console.error('Error loading stock:', e);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadStock();
  }, [filters.sucursales, filters.familias, filters.categorias, filters.tipos, filters.generos, filters.proveedores, filters.search]);

  return (
    <div className="h-full flex overflow-hidden">
      <FilterSidebar
        filters={filters}
        onFiltersChange={setFilters}
        options={options}
        isLoadingOptions={isLoadingOptions}
        hideDateRange={true} // El stock es saldo actual, no por rango de fechas
      />
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <StockTable 
          data={data} 
          isLoading={isLoading} 
          selectedSucursal={filters.sucursales.length === 1 ? filters.sucursales[0] : null}
        />
      </div>
    </div>
  );
};
