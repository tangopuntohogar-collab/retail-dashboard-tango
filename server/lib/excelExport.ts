import ExcelJS from 'exceljs';

const HEADERS = [
  'Suc.',
  'Tipo',
  'Comprobante',
  'Fecha',
  'Familia',
  'Categoría',
  'Tipo Art.',
  'Género',
  'Proveedor',
  'Cód. Art.',
  'Descripción',
  'Cliente',
  'Rubro',
  'Medio de Pago',
  'Cuotas',
  'Cant.',
  'Precio Neto',
  'Precio Unit.',
  'Total c/IVA',
  'Costo Unit.',
  'Rentab.',
] as const;

function formatDate(dateString: string): string {
  if (!dateString) return '-';
  const iso = String(dateString).split('T')[0];
  const [year, month, day] = iso.split('-');
  if (!year || !month || !day) return '-';
  return `${day}/${month}/${year.slice(-2)}`;
}

function impProp(r: Record<string, unknown>): number {
  return Number(r['Total cIVA'] ?? r['imp_prop_c_iva'] ?? r['importe_c_iva'] ?? 0);
}

function precioUnitDisplay(r: Record<string, unknown>): number {
  const pu = r['Precio Unitario'];
  if (pu != null && pu !== '') return Number(pu);
  const cant = Number(r['Cantidad'] ?? 0);
  const imp = impProp(r);
  return cant > 0 ? imp / cant : 0;
}

function isNotaCreditoTipo(tipo: string | null | undefined): boolean {
  const u = String(tipo ?? '').trim().toUpperCase();
  if (!u) return false;
  return u === 'NC' || u.startsWith('NC');
}

/** Rentab. % o null si no aplica (NC) */
function rentabilidadPct(r: Record<string, unknown>): number | null {
  const tipo = String(r['Tipo de comprobante'] ?? '');
  if (isNotaCreditoTipo(tipo)) return null;
  const precioUnit = r['Precio Unitario'] != null ? Number(r['Precio Unitario']) : null;
  const costo = r['CostoUnitario'] != null ? Number(r['CostoUnitario']) : null;
  if (precioUnit != null && costo != null && costo > 0) {
    return ((precioUnit - costo) / costo) * 100;
  }
  return 0;
}

function formatCuotas(raw: unknown): string {
  const n = Number(raw);
  if (!n) return '-';
  return `${n}c`;
}

function rowToCells(raw: Record<string, unknown>): (string | number)[] {
  const desc = String(raw['Descripción'] ?? '');
  const descAdic = raw['DescripcionAdicional'] != null ? String(raw['DescripcionAdicional']) : '';
  const descripcionFull = descAdic ? `${desc}\n${descAdic}` : desc;

  const razon = String(raw['razon_social'] ?? '');
  const codCl = raw['cod_client'] != null ? String(raw['cod_client']) : '';
  const cliente = codCl ? `${razon}\n${codCl}` : razon || '-';

  const precioNeto = raw['Precio Neto'];
  const costo = raw['CostoUnitario'];

  return [
    String(raw['Nro. Sucursal'] ?? ''),
    String(raw['Tipo de comprobante'] ?? ''),
    String(raw['Nro. Comprobante'] ?? ''),
    formatDate(String(raw['Fecha'] ?? '')),
    String(raw['Familia'] ?? '-'),
    String(raw['Categoria'] ?? '-'),
    String(raw['tipo'] ?? '-'),
    String(raw['genero'] ?? '-'),
    String(raw['PROVEEDOR (Adic.)'] ?? raw['proveedor'] ?? '-'),
    String(raw['Cód. Artículo'] ?? ''),
    descripcionFull || '-',
    cliente,
    String(raw['rubro'] ?? '-'),
    String(raw['Medio de Pago'] ?? '-'),
    formatCuotas(raw['cant_cuotas']),
    Number(raw['Cantidad'] ?? 0),
    precioNeto != null && precioNeto !== '' ? Number(precioNeto) : '',
    precioUnitDisplay(raw),
    impProp(raw),
    costo != null && Number(costo) > 0 ? Number(costo) : '',
    (() => {
      const pct = rentabilidadPct(raw);
      return pct === null ? '-' : `${pct.toFixed(1)}%`;
    })(),
  ];
}

export async function buildVentasExcelBuffer(rows: Record<string, unknown>[]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Ventas');
  ws.addRow([...HEADERS]);
  rows.forEach((raw) => {
    ws.addRow(rowToCells(raw));
  });
  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf);
}
