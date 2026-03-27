import type { AISettingsFile } from './aiSettingsStore.js';

const BASE_SYSTEM = `Sos un analista experto en retail en Argentina. Recibís un JSON con métricas agregadas
de una cadena de locales de electrodomésticos y deportes llamada Punto Hogar.
Respondé ÚNICAMENTE con un JSON válido con este formato exacto, sin texto adicional,
sin markdown, sin backticks:
{
"alertas_criticas": [{ "titulo": "string", "descripcion": "string" }],
"alertas_atencion": [{ "titulo": "string", "descripcion": "string" }],
"insights": [{ "titulo": "string", "descripcion": "string" }]
}
Máximo 3 items por categoría. Solo incluí lo que tenga evidencia en los datos.
Sé concreto y accionable. Usá español argentino informal. No uses emojis.`;

export function buildSystemPrompt(
  screen: 'dashboard' | 'detail' | 'stock',
  settings: AISettingsFile
): string {
  const u = settings.umbrales;
  let extra = '';
  if (screen === 'dashboard') {
    extra = `Analizá especialmente: saldos de caja negativos, variaciones de ventas por sucursal
vs mes anterior, concentración en medios de pago (especialmente crédito por financiera),
y sucursales sin efectivo ni transferencias.
Los umbrales configurados son: variación ventas > ${u.variacionVentasPct}%,
crédito financiera > ${u.creditoFinancieraPct}% del total,
concentración sucursal > ${u.concentracionSucursalPct}%.`;
  } else if (screen === 'detail') {
    extra = `Analizá especialmente: artículos con rentabilidad negativa o menor a ${u.rentabilidadMinPct}%,
proveedores con margen sistémicamente bajo, rubros con caída de ventas,
y concentración de ventas en una sola sucursal mayor a ${u.concentracionSucursalPct}%.`;
  } else {
    extra = `Analizá especialmente: artículos con cobertura menor a ${u.coberturaCriticaDias} días
con ventas activas (riesgo de quiebre), artículos con stock mayor a 0 pero sin ventas
en el período (stock muerto), sobrestock con cobertura mayor a ${u.coberturaAltaDias} días,
y desequilibrios entre sucursales del mismo artículo.`;
  }
  return `${BASE_SYSTEM}\n\n${extra.trim()}`;
}

const PARSE_ERROR_MSG = 'No se pudo parsear la respuesta del modelo de IA';
const RAW_MAX = 500;

function truncateRaw(s: string): string {
  return s.length > RAW_MAX ? s.slice(0, RAW_MAX) : s;
}

function parseErrorPayload(original: string): {
  error: true;
  mensaje: string;
  raw: string;
} {
  return {
    error: true,
    mensaje: PARSE_ERROR_MSG,
    raw: truncateRaw(original),
  };
}

export type ParseAIJsonResult =
  | {
      error: true;
      mensaje: string;
      raw: string;
    }
  | {
      alertas_criticas: Array<{ titulo: string; descripcion: string }>;
      alertas_atencion: Array<{ titulo: string; descripcion: string }>;
      insights: Array<{ titulo: string; descripcion: string }>;
    };

export function parseAIJson(raw: string): ParseAIJsonResult {
  const original = typeof raw === 'string' ? raw : String(raw);

  const fence = /```json\s*([\s\S]*?)```/i.exec(original);
  let candidate: string;
  if (fence?.[1] != null) {
    candidate = fence[1].trim();
  } else {
    const start = original.indexOf('{');
    const end = original.lastIndexOf('}');
    if (start === -1 || end === -1 || end <= start) {
      return parseErrorPayload(original);
    }
    candidate = original.slice(start, end + 1).trim();
  }

  try {
    const parsed = JSON.parse(candidate) as {
      alertas_criticas?: unknown;
      alertas_atencion?: unknown;
      insights?: unknown;
    };
    return {
      alertas_criticas: Array.isArray(parsed.alertas_criticas) ? (parsed.alertas_criticas as []) : [],
      alertas_atencion: Array.isArray(parsed.alertas_atencion) ? (parsed.alertas_atencion as []) : [],
      insights: Array.isArray(parsed.insights) ? (parsed.insights as []) : [],
    };
  } catch {
    return parseErrorPayload(original);
  }
}
