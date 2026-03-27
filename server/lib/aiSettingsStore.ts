import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';

export type AIProviderName = 'gemini' | 'anthropic' | 'openai';

export interface AIUmbrales {
  rentabilidadMinPct: number;
  coberturaCriticaDias: number;
  coberturaAltaDias: number;
  concentracionSucursalPct: number;
  variacionVentasPct: number;
  creditoFinancieraPct: number;
}

export interface AISettingsFile {
  provider: AIProviderName;
  umbrales: AIUmbrales;
}

const DEFAULT_SETTINGS: AISettingsFile = {
  provider: 'gemini',
  umbrales: {
    rentabilidadMinPct: 10,
    coberturaCriticaDias: 7,
    coberturaAltaDias: 90,
    concentracionSucursalPct: 50,
    variacionVentasPct: 20,
    creditoFinancieraPct: 40,
  },
};

function settingsPath(): string {
  return join(process.cwd(), 'server', 'config', 'aiSettings.json');
}

export function readAISettings(): AISettingsFile {
  const p = settingsPath();
  if (!existsSync(p)) {
    writeAISettings(DEFAULT_SETTINGS);
    return { ...DEFAULT_SETTINGS, umbrales: { ...DEFAULT_SETTINGS.umbrales } };
  }
  try {
    const raw = readFileSync(p, 'utf-8');
    const parsed = JSON.parse(raw) as Partial<AISettingsFile>;
    return mergeAISettings(DEFAULT_SETTINGS, parsed);
  } catch {
    return { ...DEFAULT_SETTINGS, umbrales: { ...DEFAULT_SETTINGS.umbrales } };
  }
}

export function writeAISettings(s: AISettingsFile): void {
  writeFileSync(settingsPath(), JSON.stringify(s, null, 2), 'utf-8');
}

function mergeAISettings(base: AISettingsFile, partial: Partial<AISettingsFile>): AISettingsFile {
  return {
    provider: partial.provider ?? base.provider,
    umbrales: {
      ...base.umbrales,
      ...(partial.umbrales ?? {}),
    },
  };
}

export function mergeAndPersist(partial: Partial<AISettingsFile>): AISettingsFile {
  const current = readAISettings();
  const next = mergeAISettings(current, partial);
  writeAISettings(next);
  return next;
}
