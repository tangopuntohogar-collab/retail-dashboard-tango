import { StockRow, StockMatrixRow } from '../types';

const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:3002/api/ventas';
const BASE_URL = API_URL.replace('/api/ventas', '');

/**
 * Trae saldos de stock desde /api/stock y los transforma en matriz (Artículo x Sucursales).
 */
export async function fetchStock(sucursales?: string[]): Promise<StockMatrixRow[]> {
  const params = new URLSearchParams();
  sucursales?.forEach(s => params.append('sucursal', String(s)));

  try {
    const url = `${BASE_URL}/api/stock?${params}`;
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

      // Asignar estadísticas de la sucursal local
      if (row.prom3m !== undefined) {
        acc[artCode].stats[nroSuc] = {
          prom12m: Number(row.prom12m) || 0,
          prom6m: Number(row.prom6m) || 0,
          prom3m: Number(row.prom3m) || 0,
          prom1m: Number(row.prom1m) || 0,
          venta30d: Number(row.venta30d) || 0,
        };
      }

      // Asignar estadísticas generales (Sucursal 1001) si no existen aún
      if (!acc[artCode].stats['1001'] && row.prom3m_gral !== undefined) {
        acc[artCode].stats['1001'] = {
          prom12m: Number(row.prom12m_gral) || 0,
          prom6m: Number(row.prom6m_gral) || 0,
          prom3m: Number(row.prom3m_gral) || 0,
          prom1m: Number(row.prom1m_gral) || 0,
          venta30d: Number(row.venta30d_gral) || 0,
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
