import { StockRow } from '../types';

const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:3002/api/ventas';
const BASE_URL = API_URL.replace('/api/ventas', '');

/**
 * Trae saldos de stock desde /api/stock.
 * Soporta filtro por sucursal.
 */
export async function fetchStock(sucursales?: string[]): Promise<StockRow[]> {
  const params = new URLSearchParams();
  sucursales?.forEach(s => params.append('sucursal', String(s)));

  try {
    const url = `${BASE_URL}/api/stock?${params}`;
    console.log('[stockService] fetchStock: Fetching URL:', url);
    const response = await fetch(url);
    console.log('[stockService] fetchStock: Response Status:', response.status);
    if (!response.ok) throw new Error(`HTTP Error ${response.status}`);

    const json = await response.json();
    return (json.data ?? []).map((row: any) => ({
      ...row,
      costo_unit: row['CostoUnitario'] != null ? Number(row['CostoUnitario']) : 0,
      fecha_ult_compra: row['FechaUltimaCompra'] ? new Date(row['FechaUltimaCompra']).toLocaleDateString('es-AR') : '-',
      descripcion_adicional: row['DescripcionAdicional'] ?? null,
    }));
  } catch (err) {
    console.error('[stockService] Error fetching stock:', err);
    throw err;
  }
}
