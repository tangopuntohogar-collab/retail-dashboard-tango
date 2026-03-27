import { getServerBaseUrl } from './apiConfig';

export interface AIAlert {
  titulo: string;
  descripcion: string;
}

export interface AIAnalysisResult {
  alertas_criticas: AIAlert[];
  alertas_atencion: AIAlert[];
  insights: AIAlert[];
  provider: string;
  analyzedAt: string;
}

export interface AISettings {
  provider: 'gemini' | 'anthropic' | 'openai';
  umbrales: {
    rentabilidadMinPct: number;
    coberturaCriticaDias: number;
    coberturaAltaDias: number;
    concentracionSucursalPct: number;
    variacionVentasPct: number;
    creditoFinancieraPct: number;
  };
}

function apiRoot(): string {
  return `${getServerBaseUrl()}/api`;
}

export async function analyzeScreen(
  screen: 'dashboard' | 'detail' | 'stock',
  payload: object
): Promise<AIAnalysisResult> {
  const res = await fetch(`${apiRoot()}/ai/analyze`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ screen, payload }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Error ${res.status}`);
  return data as AIAnalysisResult;
}

export async function getAISettings(): Promise<AISettings> {
  const res = await fetch(`${apiRoot()}/ai/settings`);
  if (!res.ok) throw new Error(`Error ${res.status}`);
  return res.json();
}

export async function updateAISettings(settings: Partial<AISettings>): Promise<AISettings> {
  const res = await fetch(`${apiRoot()}/ai/settings`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(settings),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Error ${res.status}`);
  return data as AISettings;
}

export async function getAIKeysStatus(): Promise<{ gemini: boolean; anthropic: boolean; openai: boolean }> {
  const res = await fetch(`${apiRoot()}/ai/keys-status`);
  if (!res.ok) throw new Error(`Error ${res.status}`);
  return res.json();
}
