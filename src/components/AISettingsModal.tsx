import React, { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import {
  getAISettings,
  updateAISettings,
  getAIKeysStatus,
  type AISettings,
} from '../lib/aiAnalysisService';

interface AISettingsModalProps {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
}

export const AISettingsModal: React.FC<AISettingsModalProps> = ({ open, onClose, onSaved }) => {
  const [settings, setSettings] = useState<AISettings | null>(null);
  const [keys, setKeys] = useState<{ gemini: boolean; anthropic: boolean; openai: boolean } | null>(null);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setErr(null);
    Promise.all([getAISettings(), getAIKeysStatus()])
      .then(([s, k]) => {
        setSettings(s);
        setKeys(k);
      })
      .catch((e) => setErr(e instanceof Error ? e.message : String(e)));
  }, [open]);

  if (!open) return null;

  const handleSave = async () => {
    if (!settings) return;
    setSaving(true);
    setErr(null);
    try {
      await updateAISettings(settings);
      onSaved();
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div className="bg-[#0f172a] border border-border-dark rounded-xl max-w-lg w-full max-h-[90vh] overflow-y-auto shadow-xl">
        <div className="flex items-center justify-between p-4 border-b border-border-dark">
          <h2 className="text-lg font-semibold text-white">Configuración IA</h2>
          <button type="button" onClick={onClose} className="p-2 text-slate-400 hover:text-white rounded-lg">
            <X size={20} />
          </button>
        </div>

        <div className="p-4 space-y-4">
          {keys && (
            <div className="text-xs text-slate-400 space-y-1 border border-border-dark rounded-lg p-3 bg-[#020617]">
              <p className={keys.gemini ? 'text-emerald-400' : 'text-slate-500'}>
                {keys.gemini ? '✓' : '✗'} Gemini {keys.gemini ? 'configurado' : 'sin API key'}
              </p>
              <p className={keys.anthropic ? 'text-emerald-400' : 'text-slate-500'}>
                {keys.anthropic ? '✓' : '✗'} Anthropic {keys.anthropic ? 'configurado' : 'sin API key'}
              </p>
              <p className={keys.openai ? 'text-emerald-400' : 'text-slate-500'}>
                {keys.openai ? '✓' : '✗'} OpenAI {keys.openai ? 'configurado' : 'sin API key'}
              </p>
            </div>
          )}

          {settings && (
            <>
              <label className="block">
                <span className="text-xs text-slate-400 uppercase">Proveedor activo</span>
                <select
                  className="mt-1 w-full bg-[#020617] border border-border-dark rounded-lg px-3 py-2 text-slate-200"
                  value={settings.provider}
                  onChange={(e) =>
                    setSettings({
                      ...settings,
                      provider: e.target.value as AISettings['provider'],
                    })
                  }
                >
                  <option value="gemini">Gemini</option>
                  <option value="anthropic">Claude (Anthropic)</option>
                  <option value="openai">OpenAI</option>
                </select>
              </label>

              <div className="grid gap-3 text-sm">
                <NumField
                  label="Rentabilidad mínima"
                  unit="%"
                  hint="Alerta si rentabilidad &lt; este valor"
                  value={settings.umbrales.rentabilidadMinPct}
                  onChange={(n) =>
                    setSettings({
                      ...settings,
                      umbrales: { ...settings.umbrales, rentabilidadMinPct: n },
                    })
                  }
                />
                <NumField
                  label="Cobertura crítica"
                  unit="días"
                  hint="Alerta si el stock se agota en menos de X días"
                  value={settings.umbrales.coberturaCriticaDias}
                  onChange={(n) =>
                    setSettings({
                      ...settings,
                      umbrales: { ...settings.umbrales, coberturaCriticaDias: n },
                    })
                  }
                />
                <NumField
                  label="Cobertura alta"
                  unit="días"
                  hint="Alerta si cobertura supera X días (sobrestock)"
                  value={settings.umbrales.coberturaAltaDias}
                  onChange={(n) =>
                    setSettings({
                      ...settings,
                      umbrales: { ...settings.umbrales, coberturaAltaDias: n },
                    })
                  }
                />
                <NumField
                  label="Concentración sucursal"
                  unit="%"
                  hint="Alerta si una sucursal supera X% del total"
                  value={settings.umbrales.concentracionSucursalPct}
                  onChange={(n) =>
                    setSettings({
                      ...settings,
                      umbrales: { ...settings.umbrales, concentracionSucursalPct: n },
                    })
                  }
                />
                <NumField
                  label="Variación ventas"
                  unit="%"
                  hint="Alerta si una sucursal cae más de X% vs mes anterior"
                  value={settings.umbrales.variacionVentasPct}
                  onChange={(n) =>
                    setSettings({
                      ...settings,
                      umbrales: { ...settings.umbrales, variacionVentasPct: n },
                    })
                  }
                />
                <NumField
                  label="Crédito por financiera"
                  unit="%"
                  hint="Alerta si supera X% del total de cobros"
                  value={settings.umbrales.creditoFinancieraPct}
                  onChange={(n) =>
                    setSettings({
                      ...settings,
                      umbrales: { ...settings.umbrales, creditoFinancieraPct: n },
                    })
                  }
                />
              </div>
            </>
          )}

          {err && <p className="text-rose-400 text-sm">{err}</p>}

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-lg border border-border-dark text-slate-300 hover:bg-slate-800"
            >
              Cancelar
            </button>
            <button
              type="button"
              disabled={saving || !settings}
              onClick={handleSave}
              className="px-4 py-2 rounded-lg bg-primary text-white font-medium disabled:opacity-50"
            >
              {saving ? 'Guardando…' : 'Guardar'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

function NumField(props: {
  label: string;
  unit: string;
  hint: string;
  value: number;
  onChange: (n: number) => void;
}) {
  return (
    <label className="block">
      <span className="text-slate-300">{props.label}</span>
      <span className="text-slate-500 text-xs ml-1">({props.unit})</span>
      <p className="text-[11px] text-slate-500 mb-1">{props.hint}</p>
      <input
        type="number"
        className="w-full bg-[#020617] border border-border-dark rounded-lg px-3 py-2 text-slate-200"
        value={props.value}
        onChange={(e) => props.onChange(Number(e.target.value))}
      />
    </label>
  );
}
