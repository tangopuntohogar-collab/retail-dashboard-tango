import { StockFilters, StockMatrixRow } from '../types';
import { getServerBaseUrl } from './apiConfig';

/**
 * Trae saldos de stock desde /api/stock y los transforma en matriz (Artículo x Sucursales).
 */
export async function fetchStock(filters: StockFilters): Promise<StockMatrixRow[]> {
  const params = new URLSearchParams();
  filters.sucursales?.forEach(s => params.append('sucursal', String(s)));
  if (filters.fechaDesde) params.append('fechaDesde', filters.fechaDesde);
  if (filters.fechaHasta) params.append('fechaHasta', filters.fechaHasta);

  try {
    const url = `${getServerBaseUrl()}/api/stock?${params}`;
    console.log('[stockService] fetchStock: Fetching URL:', url);
    const response = await fetch(url);
    if (!response.ok) throw new Error(`HTTP Error ${response.status}`);

    const json = await response.json();
    const rawData = json.data ?? [];

    // Agrupación por Artículo
    const matrixMap = rawData.reduce((acc: { [key: string]: StockMatrixRow }, row: any) => {
      const artCode = row.cod_art;
      
      if (!acc[artCode]) {
        acc[artCode] = {
          cod_art: artCode,
          descripcion: row.descripcion,
          descripcion_adicional: row.DescripcionAdicional ?? null,
          familia: row.familia || '-',
          categoria: row.categoria || '-',
          tipo_art: row.tipo_art || '-',
          genero: row.genero || '-',
          proveedor: row.proveedor || '-',
          costo_unit: row.CostoUnitario != null ? Number(row.CostoUnitario) : 0,
          fecha_ult_compra: row.FechaUltimaCompra ? new Date(row.FechaUltimaCompra).toLocaleDateString('es-AR') : '-',
          sucursales: {},
          stock_total: 0,
          stats: {}
        };
      }

      const saldo = Number(row.saldo) || 0;
      const nroSuc = String(row.nro_sucursal);
      
      // Asignar saldo a la sucursal específica
      acc[artCode].sucursales[nroSuc] = (acc[artCode].sucursales[nroSuc] || 0) + saldo;
      acc[artCode].stock_total += saldo;

      // Asignar estadísticas de la sucursal local (Dynamic totalVendido)
      if (row.totalVendido !== undefined) {
        acc[artCode].stats[nroSuc] = {
          totalVendido: Number(row.totalVendido) || 0,
        };
      }

      // Asignar estadísticas generales (Sucursal 1001) si no existen aún
      if (!acc[artCode].stats['1001'] && row.totalVendidoGral !== undefined) {
        acc[artCode].stats['1001'] = {
          totalVendido: Number(row.totalVendidoGral) || 0,
        };
      }

      return acc;
    }, {});

    return Object.values(matrixMap);
  } catch (err) {
    console.error('[stockService] Error fetching stock:', err);
    throw err;
  }
}
