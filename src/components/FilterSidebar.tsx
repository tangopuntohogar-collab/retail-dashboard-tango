import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
    Search, ChevronDown, ChevronUp, X, SlidersHorizontal,
    Building2, Tag, CreditCard, Users, FilterX, Loader2,
    FileSearch, CalendarDays, Hash, Layers, Box, FileText,
    VenetianMask, Truck,
} from 'lucide-react';
import { VentasFilters, StockFilters, DetailFilterOptions, getInitialFilters, getInitialStockFilters } from '../types';

interface FilterSidebarProps {
    filters: VentasFilters;
    onFiltersChange: (f: VentasFilters) => void;
    options: DetailFilterOptions;
    isLoadingOptions: boolean;
    hideDateRange?: boolean;
    /** Cuando true, onFiltersChange solo se ejecuta al hacer clic en "Aplicar Filtros" o Enter. Los inputs usan estado local temporal. */
    applyMode?: 'manual' | 'immediate';
    /** Estado de carga de datos: deshabilita el botón Aplicar y muestra feedback. */
    isLoading?: boolean;
}

/* ─── Skeleton ──────────────────────────────────────────────────────────── */
const SkeletonLines = ({ n = 4 }: { n?: number }) => (
    <div className="flex flex-col gap-2 py-1">
        {Array.from({ length: n }).map((_, i) => (
            <div
                key={i}
                className="h-3.5 rounded bg-slate-800 animate-pulse"
                style={{ width: `${60 + (i % 3) * 15}%` }}
            />
        ))}
    </div>
);

/* ─── Acordeón ─────────────────────────────────────────────────────────── */
interface AccordionProps {
    title: string;
    icon: React.ReactNode;
    count?: number;
    children: React.ReactNode;
    defaultOpen?: boolean;
    isLoading?: boolean;
}

const Accordion: React.FC<AccordionProps> = ({
    title, icon, count, children, defaultOpen = false, isLoading = false,
}) => {
    const [open, setOpen] = useState(defaultOpen);
    return (
        <div className="border-b border-slate-800 last:border-b-0">
            <button
                onClick={() => setOpen(o => !o)}
                className="w-full flex items-center justify-between px-4 py-3 text-slate-300 hover:text-white hover:bg-slate-800/50 transition-colors text-sm font-medium group"
            >
                <span className="flex items-center gap-2.5">
                    <span className="text-slate-400 group-hover:text-primary transition-colors">{icon}</span>
                    <span>
                        {count != null && count > 0
                            ? <>{title} <span className="text-primary font-semibold">({count})</span></>
                            : title
                        }
                    </span>
                    {isLoading && <Loader2 size={12} className="animate-spin text-slate-500 ml-1" />}
                </span>
                {open
                    ? <ChevronUp size={14} className="text-slate-500" />
                    : <ChevronDown size={14} className="text-slate-500" />}
            </button>
            {open && (
                <div className="px-4 pb-3 flex flex-col gap-1.5 max-h-52 overflow-y-auto scrollbar-thin scrollbar-thumb-slate-700 scrollbar-track-transparent">
                    {isLoading ? <SkeletonLines n={5} /> : children}
                </div>
            )}
        </div>
    );
};

/* ─── Checkbox ──────────────────────────────────────────────────────────── */
const CheckItem: React.FC<{ label: string; checked: boolean; onChange: () => void }> = ({ label, checked, onChange }) => (
    <label className="flex items-center gap-2.5 py-0.5 cursor-pointer group select-none">
        <div
            className={`size-4 rounded border flex items-center justify-center shrink-0 transition-all ${checked ? 'bg-primary border-primary' : 'border-slate-600 group-hover:border-slate-400 bg-transparent'
                }`}
            onClick={onChange}
        >
            {checked && (
                <svg className="size-2.5" viewBox="0 0 10 8" fill="none">
                    <path d="M1.5 4L4 6.5L9 1" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
            )}
        </div>
        <span className="text-xs text-slate-400 group-hover:text-slate-200 transition-colors truncate" title={label}>
            {label}
        </span>
    </label>
);

/* ─── CheckList with internal search (for big lists like Clientes) ──────── */
const SearchableCheckList: React.FC<{
    items: string[];
    selected: string[];
    onToggle: (v: string) => void;
    placeholder?: string;
}> = ({ items, selected, onToggle, placeholder = 'Buscar...' }) => {
    const [localSearch, setLocalSearch] = useState('');
    const filtered = localSearch
        ? items.filter(i => i.toLowerCase().includes(localSearch.toLowerCase()))
        : items;

    return (
        <>
            <div className="relative mb-1.5">
                <Search size={11} className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-500 pointer-events-none" />
                <input
                    type="text"
                    placeholder={placeholder}
                    value={localSearch}
                    onChange={e => setLocalSearch(e.target.value)}
                    className="w-full bg-slate-900 border border-slate-700 text-slate-300 placeholder-slate-600 rounded pl-6 pr-6 py-1 text-[11px] focus:outline-none focus:border-primary/50 transition-colors"
                />
                {localSearch && (
                    <button onClick={() => setLocalSearch('')} className="absolute right-1.5 top-1/2 -translate-y-1/2 text-slate-500 hover:text-white">
                        <X size={11} />
                    </button>
                )}
            </div>
            {filtered.length === 0
                ? <span className="text-xs text-slate-500 py-1">Sin coincidencias</span>
                : filtered.map(item => (
                    <CheckItem
                        key={item}
                        label={item}
                        checked={selected.includes(item)}
                        onChange={() => onToggle(item)}
                    />
                ))
            }
        </>
    );
};

/* ─── Input de fecha estilizado ─────────────────────────────────────────── */
const DateInput: React.FC<{
    label: string;
    value: string;
    onChange: (v: string) => void;
}> = ({ label, value, onChange }) => (
    <div className="flex flex-col gap-1">
        <span className="text-[10px] text-slate-500 uppercase tracking-wide font-medium">{label}</span>
        <input
            type="date"
            value={value}
            onChange={e => onChange(e.target.value)}
            className="w-full bg-slate-800/70 border border-slate-700 text-slate-200 rounded-md px-2.5 py-1.5 text-xs focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/30 transition-colors [color-scheme:dark]"
        />
    </div>
);

/* ─── Helper: compara dos objetos de filtros (shallow) para detectar cambios ── */
function filtersEqual(a: VentasFilters | StockFilters, b: VentasFilters | StockFilters): boolean {
    const keys = Object.keys(a) as (keyof VentasFilters)[];
    return keys.every(k => {
        const va = a[k], vb = b[k];
        if (Array.isArray(va) && Array.isArray(vb)) return va.length === vb.length && va.every((v, i) => v === vb[i]);
        return va === vb;
    });
}

/* ─── FilterSidebar ──────────────────────────────────────────────────────── */
export const FilterSidebar: React.FC<FilterSidebarProps> = ({
    filters, onFiltersChange, options, isLoadingOptions, hideDateRange = false, view = 'sales',
    applyMode = 'manual',
    isLoading: isDataLoading = false,
}) => {
    const isStock = view === 'stock';

    // En modo manual: tempFilters es el estado local; solo se aplica al padre con el botón/Enter.
    const [tempFilters, setTempFilters] = useState<VentasFilters | StockFilters>(() => filters);

    // Sync tempFilters cuando el padre cambia (ej: reset, o efecto de mediosPago en App)
    useEffect(() => {
        setTempFilters(filters);
    }, [filters]);

    const asVentas = tempFilters as VentasFilters;
    const isManual = applyMode === 'manual';

    const [isOpen, setIsOpen] = useState(false);
    const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const tempFiltersRef = useRef(tempFilters);
    tempFiltersRef.current = tempFilters;

    const handleSearchChange = useCallback((val: string) => {
        setTempFilters(f => ({ ...f, search: val }));
        if (!isManual) {
            if (debounceRef.current) clearTimeout(debounceRef.current);
            debounceRef.current = setTimeout(() => {
                onFiltersChange({ ...tempFiltersRef.current, search: val } as VentasFilters);
            }, 420);
        }
    }, [isManual, onFiltersChange]);

    const handleComprobanteChange = useCallback((val: string) => {
        if (isStock) return;
        setTempFilters(f => ({ ...f, comprobante: val }));
        if (!isManual) {
            if (debounceRef.current) clearTimeout(debounceRef.current);
            debounceRef.current = setTimeout(() => {
                onFiltersChange({ ...tempFiltersRef.current, comprobante: val } as VentasFilters);
            }, 420);
        }
    }, [isStock, isManual, onFiltersChange]);

    const toggle = useCallback((key: string, val: string) => {
        const current = (tempFilters[key as keyof typeof tempFilters] as string[]) || [];
        const next = current.includes(val) ? current.filter(v => v !== val) : [...current, val];
        const updated = { ...tempFilters, [key]: next };
        setTempFilters(updated);
        if (!isManual) onFiltersChange(updated as VentasFilters);
    }, [tempFilters, isManual, onFiltersChange]);

    const toggleMedioPago = useCallback((val: string) => {
        if (isStock) return;
        const current = asVentas.mediosPago;
        const next = current.includes(val) ? current.filter(v => v !== val) : [...current, val];
        const updated = { ...tempFilters, mediosPago: next };
        setTempFilters(updated);
        if (!isManual) onFiltersChange(updated as VentasFilters);
    }, [isStock, asVentas.mediosPago, tempFilters, isManual, onFiltersChange]);

    const toggleCuota = useCallback((val: number) => {
        if (isStock) return;
        const current = asVentas.cuotas;
        const next = current.includes(val) ? current.filter(v => v !== val) : [...current, val];
        const updated = { ...tempFilters, cuotas: next };
        setTempFilters(updated);
        if (!isManual) onFiltersChange(updated as VentasFilters);
    }, [isStock, asVentas.cuotas, tempFilters, isManual, onFiltersChange]);

    const handleApplyFilters = useCallback((e?: React.FormEvent) => {
        e?.preventDefault();
        if (isDataLoading) return;
        onFiltersChange(tempFilters as VentasFilters);
    }, [tempFilters, onFiltersChange, isDataLoading]);

    const { fechaDesde: defaultDesde, fechaHasta: defaultHasta } = isStock ? getInitialStockFilters() : getInitialFilters();
    const datesModified = tempFilters.fechaDesde !== defaultDesde || tempFilters.fechaHasta !== defaultHasta;

    const activeCount =
        tempFilters.sucursales.length +
        tempFilters.familias.length +
        tempFilters.categorias.length +
        tempFilters.tipos.length +
        tempFilters.generos.length +
        tempFilters.proveedores.length +
        (tempFilters.search ? 1 : 0) +
        (datesModified ? 1 : 0) +
        (!isStock ? (
            asVentas.rubros.length +
            asVentas.mediosPago.length +
            asVentas.cuentas.length +
            asVentas.clientes.length +
            asVentas.cuotas.length +
            (asVentas.comprobante ? 1 : 0)
        ) : 0);

    const hasPendingChanges = isManual && !filtersEqual(tempFilters, filters);

    const handleClear = useCallback(() => {
        const initial = isStock ? getInitialStockFilters() : getInitialFilters();
        setTempFilters(initial);
        if (!isManual) onFiltersChange(initial);
    }, [isStock, onFiltersChange, isManual]);

    const handleDateChange = useCallback((key: 'fechaDesde' | 'fechaHasta', val: string) => {
        const updated = { ...tempFilters, [key]: val };
        setTempFilters(updated);
        if (!isManual) onFiltersChange(updated as VentasFilters);
    }, [tempFilters, isManual, onFiltersChange]);

    const handleClearDates = useCallback(() => {
        const updated = { ...tempFilters, fechaDesde: '', fechaHasta: '' };
        setTempFilters(updated);
        if (!isManual) onFiltersChange(updated as VentasFilters);
    }, [tempFilters, onFiltersChange, isManual]);

    if (!isOpen) {
        return (
            <aside className="h-full flex flex-col items-center py-4 gap-4 bg-[#080e18] border-r border-slate-800 w-12 shrink-0 z-10">
                <button
                    onClick={() => setIsOpen(true)}
                    className="text-slate-400 hover:text-white transition-colors p-1 rounded"
                    title="Expandir filtros"
                >
                    <SlidersHorizontal size={18} />
                </button>
                {activeCount > 0 && (
                    <span className="size-5 flex items-center justify-center rounded-full bg-primary text-[10px] text-white font-bold">
                        {activeCount}
                    </span>
                )}
            </aside>
        );
    }

    // ── Expanded ──────────────────────────────────────────────────────────────
    return (
        <aside className="h-full flex flex-col bg-[#080e18] border-r border-slate-800 w-64 shrink-0 z-10 overflow-hidden">
            <form onSubmit={handleApplyFilters} className="h-full flex flex-col overflow-hidden">

            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3.5 border-b border-slate-800 shrink-0">
                <div className="flex items-center gap-2">
                    <SlidersHorizontal size={15} className="text-primary" />
                    <span className="text-sm font-semibold text-white">Filtros</span>
                    {isLoadingOptions
                        ? <Loader2 size={12} className="animate-spin text-slate-500 ml-1" />
                        : activeCount > 0 && (
                            <span className="size-4 flex items-center justify-center rounded-full bg-primary text-[10px] text-white font-bold ml-0.5">
                                {activeCount}
                            </span>
                        )
                    }
                </div>
                <button
                    onClick={() => setIsOpen(false)}
                    className="text-slate-500 hover:text-white transition-colors p-1 rounded"
                    title="Colapsar"
                >
                    <ChevronDown size={15} className="rotate-90" />
                </button>
            </div>

            {/* Controles fijos (sin scroll) */}
            <div className="shrink-0 border-b border-slate-800">

                {/* Date Range Picker */}
                {!hideDateRange && (
                    <div className="px-4 py-3 border-b border-slate-800">
                        <div className="flex items-center gap-2 mb-2.5">
                            <CalendarDays size={13} className="text-slate-400" />
                            <span className="text-xs font-medium text-slate-300">Rango de Fecha</span>
                            {(tempFilters.fechaDesde || tempFilters.fechaHasta) && (
                                <button
                                    type="button"
                                    onClick={handleClearDates}
                                    className="ml-auto text-slate-500 hover:text-rose-400 transition-colors"
                                    title="Limpiar fechas"
                                >
                                    <X size={12} />
                                </button>
                            )}
                        </div>
                        <div className="flex flex-col gap-2">
                            <DateInput
                                label="Desde"
                                value={tempFilters.fechaDesde}
                                onChange={v => handleDateChange('fechaDesde', v)}
                            />
                            <DateInput
                                label="Hasta"
                                value={tempFilters.fechaHasta}
                                onChange={v => handleDateChange('fechaHasta', v)}
                            />
                        </div>
                    </div>
                )}

                {/* Búsqueda por artículo */}
                <div className="px-4 py-3 border-b border-slate-800">
                    <div className="relative">
                        <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500 pointer-events-none" />
                        <input
                            type="text"
                            placeholder="Cód. o Descripción..."
                            value={tempFilters.search}
                            onChange={e => handleSearchChange(e.target.value)}
                            className="w-full bg-slate-800/70 border border-slate-700 text-slate-200 placeholder-slate-500 rounded-md pl-8 pr-7 py-1.5 text-xs focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/30 transition-colors"
                        />
                        {tempFilters.search && (
                            <button
                                type="button"
                                onClick={() => handleSearchChange('')}
                                className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-500 hover:text-white transition-colors"
                            >
                                <X size={12} />
                            </button>
                        )}
                    </div>
                </div>

                {/* Búsqueda por comprobante */}
                {!isStock && (
                    <div className="px-4 py-3 border-b border-slate-800">
                        <div className="relative">
                            <FileSearch size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500 pointer-events-none" />
                            <input
                                type="text"
                                placeholder="N° de Comprobante..."
                                value={asVentas.comprobante}
                                onChange={e => handleComprobanteChange(e.target.value)}
                                className="w-full bg-slate-800/70 border border-slate-700 text-slate-200 placeholder-slate-500 rounded-md pl-8 pr-7 py-1.5 text-xs focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/30 transition-colors"
                            />
                            {asVentas.comprobante && (
                                <button
                                    type="button"
                                    onClick={() => handleComprobanteChange('')}
                                    className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-500 hover:text-white transition-colors"
                                >
                                    <X size={12} />
                                </button>
                            )}
                        </div>
                    </div>
                )}

                {/* El bloque de Período de Análisis ha sido eliminado ya que ahora es dinámico */}
            </div>

            {/* Acordeones con scroll */}
            <div className="flex-1 overflow-y-auto scrollbar-thin scrollbar-thumb-slate-800 scrollbar-track-transparent">

                {/* Sucursal */}
                <Accordion
                    title="Sucursal"
                    icon={<Building2 size={14} />}
                    count={tempFilters.sucursales.length}
                    isLoading={isLoadingOptions}
                    defaultOpen
                >
                    {options.sucursales.length === 0
                        ? <span className="text-xs text-slate-500">Sin datos para el período</span>
                        : options.sucursales.map(s => (
                            <CheckItem
                                key={s}
                                label={`Suc. ${s}`}
                                checked={tempFilters.sucursales.includes(s)}
                                onChange={() => toggle('sucursales', s)}
                            />
                        ))
                    }
                </Accordion>

                {/* Rubro */}
                {!isStock && (
                    <Accordion
                        title="Rubro"
                        icon={<Tag size={14} />}
                        count={asVentas.rubros.length}
                        isLoading={isLoadingOptions}
                        defaultOpen
                    >
                        {options.rubros.length === 0
                            ? <span className="text-xs text-slate-500">Sin datos</span>
                            : options.rubros.map(r => (
                                <CheckItem
                                    key={r}
                                    label={r}
                                    checked={asVentas.rubros.includes(r)}
                                    onChange={() => toggle('rubros', r)}
                                />
                            ))
                        }
                    </Accordion>
                )}

                {/* Familia */}
                <Accordion
                    title="Familia"
                    icon={<Layers size={14} />}
                    count={tempFilters.familias.length}
                    isLoading={isLoadingOptions}
                >
                    {options.familias.length === 0
                        ? <span className="text-xs text-slate-500">Sin datos para el período</span>
                        : <SearchableCheckList
                            items={options.familias}
                            selected={tempFilters.familias}
                            onToggle={v => toggle('familias', v)}
                            placeholder="Buscar familia..."
                        />
                    }
                </Accordion>

                {/* Medio de Pago — valores dinámicos desde la columna SQL 'Medio de Pago' */}
                {!isStock && (
                    <Accordion
                        title="Medio de Pago"
                        icon={<CreditCard size={14} />}
                        count={asVentas.mediosPago.length}
                        isLoading={isLoadingOptions}
                    >
                        {options.mediosPago.length === 0
                            ? <span className="text-xs text-slate-500">Sin datos para el período</span>
                            : <SearchableCheckList
                                items={options.mediosPago}
                                selected={asVentas.mediosPago}
                                onToggle={toggleMedioPago}
                                placeholder="Buscar medio de pago..."
                            />
                        }
                    </Accordion>
                )}

                {/* Cuotas — dinámico via DISTINCT cant_cuotas */}
                {!isStock && (
                    <Accordion
                        title="Cuotas"
                        icon={<Hash size={14} />}
                        count={asVentas.cuotas.length}
                        isLoading={isLoadingOptions}
                    >
                        {options.cuotas.length === 0
                            ? <span className="text-xs text-slate-500">Sin cuotas en el período</span>
                            : options.cuotas.map(c => (
                                <CheckItem
                                    key={c}
                                    label={`${c} cuota${c === 1 ? '' : 's'}`}
                                    checked={asVentas.cuotas.includes(c)}
                                    onChange={() => toggleCuota(c)}
                                />
                            ))
                        }
                    </Accordion>
                )}

                {/* Categoría */}
                <Accordion
                    title="Categoría"
                    icon={<Box size={14} />}
                    count={tempFilters.categorias.length}
                    isLoading={isLoadingOptions}
                >
                    {options.categorias.length === 0
                        ? <span className="text-xs text-slate-500">Sin datos para el período</span>
                        : <SearchableCheckList
                            items={options.categorias}
                            selected={tempFilters.categorias}
                            onToggle={v => toggle('categorias', v)}
                            placeholder="Buscar categoría..."
                        />
                    }
                </Accordion>

                {/* Tipo */}
                <Accordion
                    title="Tipo"
                    icon={<FileText size={14} />}
                    count={tempFilters.tipos.length}
                    isLoading={isLoadingOptions}
                >
                    {options.tipos.length === 0
                        ? <span className="text-xs text-slate-500">Sin datos para el período</span>
                        : <SearchableCheckList
                            items={options.tipos}
                            selected={tempFilters.tipos}
                            onToggle={v => toggle('tipos', v)}
                            placeholder="Buscar tipo..."
                        />
                    }
                </Accordion>

                {/* Género */}
                <Accordion
                    title="Género"
                    icon={<VenetianMask size={14} />}
                    count={tempFilters.generos.length}
                    isLoading={isLoadingOptions}
                >
                    {options.generos.length === 0
                        ? <span className="text-xs text-slate-500">Sin datos para el período</span>
                        : <SearchableCheckList
                            items={options.generos}
                            selected={tempFilters.generos}
                            onToggle={v => toggle('generos', v)}
                            placeholder="Buscar género..."
                        />
                    }
                </Accordion>

                {/* Proveedor */}
                <Accordion
                    title="Proveedor"
                    icon={<Truck size={14} />}
                    count={tempFilters.proveedores.length}
                    isLoading={isLoadingOptions}
                >
                    {options.proveedores.length === 0
                        ? <span className="text-xs text-slate-500">Sin datos para el período</span>
                        : <SearchableCheckList
                            items={options.proveedores}
                            selected={tempFilters.proveedores}
                            onToggle={v => toggle('proveedores', v)}
                            placeholder="Buscar proveedor..."
                        />
                    }
                </Accordion>

                {/* Cliente — con buscador interno */}
                {!isStock && (
                    <Accordion
                        title="Cliente"
                        icon={<Users size={14} />}
                        count={asVentas.clientes.length}
                        isLoading={isLoadingOptions}
                    >
                        {options.clientes.length === 0
                            ? <span className="text-xs text-slate-500">Sin datos para el período</span>
                            : <SearchableCheckList
                                items={options.clientes}
                                selected={asVentas.clientes}
                                onToggle={v => toggle('clientes', v)}
                                placeholder="Buscar cliente..."
                            />
                        }
                    </Accordion>
                )}
            </div>

            {/* Footer: Aplicar (manual) + Limpiar */}
            <div className="shrink-0 px-4 py-3 border-t border-slate-800 flex flex-col gap-2">
                {isManual && (
                    <button
                        type="submit"
                        disabled={isDataLoading || !hasPendingChanges}
                        className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg bg-primary hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-semibold transition-all shadow-lg shadow-primary/20"
                    >
                        {isDataLoading ? (
                            <Loader2 size={14} className="animate-spin" />
                        ) : (
                            <SlidersHorizontal size={14} />
                        )}
                        {isDataLoading ? 'Cargando...' : 'Aplicar Filtros'}
                    </button>
                )}
                {activeCount > 0 && (
                    <button
                        type="button"
                        onClick={handleClear}
                        className="w-full flex items-center justify-center gap-2 py-2 rounded-lg border border-rose-500/30 text-rose-400 hover:bg-rose-500/10 hover:border-rose-500/50 transition-all text-xs font-medium"
                    >
                        <FilterX size={13} />
                        Limpiar filtros ({activeCount})
                    </button>
                )}
            </div>
            </form>
        </aside >
    );
};
