import React, { useCallback, useEffect, useState } from 'react';
import { Loader2, Settings, AlertCircle, ChevronUp, ChevronDown } from 'lucide-react';
import {
  analyzeScreen,
  getAISettings,
  type AIAnalysisResult,
} from '../lib/aiAnalysisService';
import { AISettingsModal } from './AISettingsModal';

const LS_KEY_COLLAPSED = 'ai-panel-collapsed';

const PROVIDER_LABELS: Record<string, string> = {
  gemini: 'Gemini',
  anthropic: 'Claude (Anthropic)',
  openai: 'OpenAI',
};

function formatRelativeTime(iso: string): string {
  const t = new Date(iso).getTime();
  const diff = Date.now() - t;
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'hace un momento';
  if (m < 60) return `hace ${m} minuto${m === 1 ? '' : 's'}`;
  const h = Math.floor(m / 60);
  if (h < 24) return `hace ${h} hora${h === 1 ? '' : 's'}`;
  const d = Math.floor(h / 24);
  return `hace ${d} día${d === 1 ? '' : 's'}`;
}

function readCollapsedFromStorage(): boolean {
  try {
    return localStorage.getItem(LS_KEY_COLLAPSED) === 'true';
  } catch {
    return false;
  }
}

function writeCollapsedToStorage(collapsed: boolean): void {
  try {
    localStorage.setItem(LS_KEY_COLLAPSED, String(collapsed));
  } catch {
    /* ignore */
  }
}

interface AIAnalysisPanelProps {
  screen: 'dashboard' | 'detail' | 'stock';
  payload: object | null;
  /** Tras guardar umbrales/proveedor (p.ej. recargar settings en el padre para métricas) */
  onSettingsSaved?: () => void;
}

export const AIAnalysisPanel: React.FC<AIAnalysisPanelProps> = ({
  screen,
  payload,
  onSettingsSaved,
}) => {
  const [result, setResult] = useState<AIAnalysisResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [providerLabel, setProviderLabel] = useState('IA');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(readCollapsedFromStorage);

  const toggleCollapsed = useCallback(() => {
    setCollapsed((c) => {
      const next = !c;
      writeCollapsedToStorage(next);
      return next;
    });
  }, []);

  useEffect(() => {
    getAISettings()
      .then((s) => setProviderLabel(PROVIDER_LABELS[s.provider] ?? s.provider))
      .catch(() => {});
  }, [settingsOpen]);

  const runAnalyze = useCallback(async () => {
    if (!payload) return;
    setLoading(true);
    setError(null);
    try {
      const r = await analyzeScreen(screen, payload);
      setResult(r);
      setProviderLabel(PROVIDER_LABELS[r.provider] ?? r.provider);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Error al analizar';
      setError(msg);
    } finally {
      setLoading(false);
    }
  }, [screen, payload]);

  const crit = result?.alertas_criticas?.length ?? 0;
  const att = result?.alertas_atencion?.length ?? 0;
  const ins = result?.insights?.length ?? 0;

  return (
    <>
      <div className="rounded-xl border border-border-dark bg-card-dark p-4 shadow-sm mt-6">
        <div className={`flex items-center justify-between gap-2 ${collapsed ? '' : 'mb-4'}`}>
          <div className="flex items-center gap-2 min-w-0">
            <h3 className="text-base font-semibold text-white shrink-0">Análisis IA</h3>
            {collapsed && result && (
              <span className="flex items-center gap-1.5" aria-hidden>
                {crit > 0 && (
                  <span className="size-2 rounded-full bg-rose-500 shrink-0" title="Alertas críticas" />
                )}
                {att > 0 && (
                  <span className="size-2 rounded-full bg-amber-400 shrink-0" title="Alertas de atención" />
                )}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={toggleCollapsed}
              className="p-2 rounded-lg border border-border-dark text-slate-300 hover:bg-slate-800"
              title={collapsed ? 'Expandir panel' : 'Colapsar panel'}
              aria-expanded={!collapsed}
            >
              {collapsed ? <ChevronDown size={18} /> : <ChevronUp size={18} />}
            </button>
            <button
              type="button"
              onClick={() => runAnalyze()}
              disabled={loading || !payload}
              className="px-3 py-1.5 rounded-lg bg-primary text-white text-sm font-medium hover:bg-blue-600 disabled:opacity-50"
            >
              Analizar con IA
            </button>
            <button
              type="button"
              onClick={() => setSettingsOpen(true)}
              className="p-2 rounded-lg border border-border-dark text-slate-300 hover:bg-slate-800"
              title="Configuración"
            >
              <Settings size={18} />
            </button>
          </div>
        </div>

        {!collapsed && (
          <>
            <div className="max-h-[400px] overflow-y-auto scroll-smooth space-y-4 text-sm [scrollbar-gutter:stable]">
              {loading && (
                <div className="flex items-center gap-3 py-4 text-slate-400">
                  <Loader2 className="animate-spin text-primary" size={22} />
                  <span>Analizando con {providerLabel}...</span>
                </div>
              )}

              {!loading && error && (
                <div className="flex flex-col gap-2 py-2 text-rose-400">
                  <div className="flex items-center gap-2">
                    <AlertCircle size={18} />
                    <span>{error}</span>
                  </div>
                  <button type="button" className="text-primary underline text-sm w-fit" onClick={() => runAnalyze()}>
                    Reintentar
                  </button>
                </div>
              )}

              {!loading && !error && result && (
                <>
                  {crit > 0 && (
                    <section>
                      <h4 className="text-rose-400 font-bold text-xs uppercase tracking-wider mb-2">
                        🔴 CRÍTICO ({crit})
                      </h4>
                      <ul className="space-y-3 text-slate-300">
                        {result.alertas_criticas.map((a, i) => (
                          <li key={i}>
                            <span className="font-semibold text-slate-200">• {a.titulo}</span>
                            <p className="text-slate-400 mt-0.5 pl-3 border-l border-rose-500/30">{a.descripcion}</p>
                          </li>
                        ))}
                      </ul>
                    </section>
                  )}

                  {att > 0 && (
                    <section>
                      <h4 className="text-amber-400 font-bold text-xs uppercase tracking-wider mb-2">
                        🟡 ATENCIÓN ({att})
                      </h4>
                      <ul className="space-y-3 text-slate-300">
                        {result.alertas_atencion.map((a, i) => (
                          <li key={i}>
                            <span className="font-semibold text-slate-200">• {a.titulo}</span>
                            <p className="text-slate-400 mt-0.5 pl-3 border-l border-amber-500/30">{a.descripcion}</p>
                          </li>
                        ))}
                      </ul>
                    </section>
                  )}

                  {ins > 0 && (
                    <section>
                      <h4 className="text-emerald-400 font-bold text-xs uppercase tracking-wider mb-2">
                        🟢 INSIGHTS ({ins})
                      </h4>
                      <ul className="space-y-3 text-slate-300">
                        {result.insights.map((a, i) => (
                          <li key={i}>
                            <span className="font-semibold text-slate-200">• {a.titulo}</span>
                            <p className="text-slate-400 mt-0.5 pl-3 border-l border-emerald-500/30">{a.descripcion}</p>
                          </li>
                        ))}
                      </ul>
                    </section>
                  )}
                </>
              )}

              {!loading && !error && !result && payload && (
                <p className="text-slate-500">Pulsa &quot;Analizar con IA&quot; para generar alertas.</p>
              )}

              {!payload && <p className="text-slate-500">Sin datos para analizar.</p>}
            </div>

            {!loading && !error && result && (
              <div className="pt-3 mt-3 border-t border-border-dark text-xs text-slate-500">
                <p>Analizado con {PROVIDER_LABELS[result.provider] ?? result.provider}</p>
                <p>Última vez: {formatRelativeTime(result.analyzedAt)}</p>
              </div>
            )}
          </>
        )}
      </div>

      <AISettingsModal
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        onSaved={() => {
          setSettingsOpen(false);
          getAISettings()
            .then((s) => setProviderLabel(PROVIDER_LABELS[s.provider] ?? s.provider))
            .catch(() => {});
          onSettingsSaved?.();
        }}
      />
    </>
  );
};
