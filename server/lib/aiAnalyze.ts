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

export function parseAIJson(raw: string): {
  alertas_criticas: Array<{ titulo: string; descripcion: string }>;
  alertas_atencion: Array<{ titulo: string; descripcion: string }>;
  insights: Array<{ titulo: string; descripcion: string }>;
} {
  const clean = raw.replace(/```json|```/g, '').trim();
  const parsed = JSON.parse(clean) as {
    alertas_criticas?: unknown;
    alertas_atencion?: unknown;
    insights?: unknown;
  };
  return {
    alertas_criticas: Array.isArray(parsed.alertas_criticas) ? (parsed.alertas_criticas as []) : [],
    alertas_atencion: Array.isArray(parsed.alertas_atencion) ? (parsed.alertas_atencion as []) : [],
    insights: Array.isArray(parsed.insights) ? (parsed.insights as []) : [],
  };
}
