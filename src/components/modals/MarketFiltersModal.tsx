import React, { useState } from 'react';
import { lpfDataService } from '../../services/lpfDataService';
import { Position } from '../../types/fantasy';

interface MarketFiltersModalProps {
  onClose: () => void;
  onApply: (filters: MarketFilterValues) => void;
}

export interface MarketFilterValues {
  position: 'ALL' | Position;
  maxPrice: number;
  clubId: string;
  onlyStarters: boolean;
  excludeInjured: boolean;
  highFormOnly: boolean;
  sortBy: string;
}

export const MarketFiltersModal: React.FC<MarketFiltersModalProps> = ({
  onClose,
  onApply
}) => {
  const clubs = lpfDataService.getClubs();
  const [position, setPosition] = useState<'ALL' | Position>('ALL');
  const [maxPrice, setMaxPrice] = useState<number>(18.0);
  const [selectedClub, setSelectedClub] = useState<string>('ALL');
  const [onlyStarters, setOnlyStarters] = useState(false);
  const [excludeInjured, setExcludeInjured] = useState(true);
  const [highFormOnly, setHighFormOnly] = useState(false);
  const [sortBy, setSortBy] = useState('pts');

  const handleApply = () => {
    onApply({
      position,
      maxPrice,
      clubId: selectedClub,
      onlyStarters,
      excludeInjured,
      highFormOnly,
      sortBy
    });
    onClose();
  };

  const handleReset = () => {
    setPosition('ALL');
    setMaxPrice(18.0);
    setSelectedClub('ALL');
    setOnlyStarters(false);
    setExcludeInjured(false);
    setHighFormOnly(false);
    setSortBy('pts');
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-surface-container-lowest/85 backdrop-blur-md px-gutter-mobile pb-safe">
      <div className="flex flex-col w-full max-w-lg bg-surface-container rounded-t-2xl sm:rounded-2xl shadow-2xl overflow-hidden border border-surface-container-high/60 max-h-[90vh]">
        {/* Header */}
        <div className="p-space-md bg-surface-container-low flex items-center justify-between border-b border-surface-container-high">
          <div className="flex items-center gap-space-xs">
            <span className="material-symbols-outlined text-primary text-[24px]">tune</span>
            <div className="flex flex-col">
              <h2 className="font-headline-lg text-headline-lg uppercase text-on-surface leading-none">
                Filtros del Mercado
              </h2>
              <span className="font-label-sm text-label-sm text-on-surface-variant mt-0.5">
                Refina tu búsqueda de jugadores
              </span>
            </div>
          </div>

          <button
            onClick={onClose}
            className="w-9 h-9 rounded-full bg-surface-container-high flex items-center justify-center text-on-surface-variant hover:text-on-surface transition-colors"
          >
            <span className="material-symbols-outlined text-[20px]">close</span>
          </button>
        </div>

        {/* Filters Body */}
        <div className="p-space-md overflow-y-auto space-y-space-md flex-1">
          {/* Demarcación táctica */}
          <div className="space-y-space-xs">
            <span className="font-headline-sm text-headline-sm uppercase text-on-surface tracking-wider">
              Demarcación Táctica
            </span>
            <div className="grid grid-cols-5 gap-space-2xs">
              {(['ALL', 'GK', 'DEF', 'MID', 'FWD'] as const).map(p => (
                <button
                  key={p}
                  onClick={() => setPosition(p)}
                  className={`py-2 rounded-lg font-headline-sm text-headline-sm uppercase tracking-wider transition-colors ${
                    position === p
                      ? 'bg-primary-container text-on-primary font-bold shadow'
                      : 'bg-surface-container-low text-on-surface-variant hover:bg-surface-container-high'
                  }`}
                >
                  {p === 'ALL' ? 'Todos' : p === 'GK' ? 'POR' : p === 'FWD' ? 'DEL' : p === 'MID' ? 'MED' : 'DEF'}
                </button>
              ))}
            </div>
          </div>

          {/* Presupuesto de Fichaje */}
          <div className="space-y-space-xs">
            <div className="flex items-center justify-between">
              <span className="font-headline-sm text-headline-sm uppercase text-on-surface tracking-wider">
                Presupuesto Máximo
              </span>
              <span className="font-stat-counter text-stat-counter text-primary font-bold">
                ${maxPrice.toFixed(1)}M
              </span>
            </div>
            <input
              type="range"
              min="4.0"
              max="18.0"
              step="0.1"
              value={maxPrice}
              onChange={e => setMaxPrice(parseFloat(e.target.value))}
              className="w-full accent-primary cursor-pointer"
            />
            <div className="flex items-center justify-between text-on-surface-variant font-label-sm text-[10px]">
              <span>$4.0M Económico</span>
              <span>$10.0M Intermedio</span>
              <span>$18.0M Premium</span>
            </div>
          </div>

          {/* Clubes Oficiales LPF */}
          <div className="space-y-space-xs">
            <span className="font-headline-sm text-headline-sm uppercase text-on-surface tracking-wider">
              Club LPF
            </span>
            <div className="grid grid-cols-4 gap-space-2xs max-h-36 overflow-y-auto no-scrollbar">
              <button
                onClick={() => setSelectedClub('ALL')}
                className={`p-2 rounded-lg font-label-sm text-label-sm uppercase flex items-center justify-center text-center transition-colors ${
                  selectedClub === 'ALL'
                    ? 'bg-primary-container text-on-primary font-bold'
                    : 'bg-surface-container-low text-on-surface-variant hover:bg-surface-container-high'
                }`}
              >
                Todos
              </button>
              {clubs.map(club => (
                <button
                  key={club.id}
                  onClick={() => setSelectedClub(club.id)}
                  className={`p-1.5 rounded-lg flex flex-col items-center gap-1 transition-colors ${
                    selectedClub === club.id
                      ? 'bg-primary-container/20 border border-primary'
                      : 'bg-surface-container-low hover:bg-surface-container-high'
                  }`}
                >
                  <img className="w-6 h-6 object-contain" src={club.logoUrl} alt={club.shortName} />
                  <span className="font-label-sm text-[10px] text-on-surface truncate w-full text-center">
                    {club.shortName}
                  </span>
                </button>
              ))}
            </div>
          </div>

          {/* Condición y Métricas de Rendimiento */}
          <div className="space-y-space-xs">
            <span className="font-headline-sm text-headline-sm uppercase text-on-surface tracking-wider">
              Condición y Métricas
            </span>
            <div className="space-y-space-2xs">
              <label className="flex items-center justify-between p-space-xs bg-surface-container-low rounded-lg cursor-pointer">
                <span className="text-body-sm text-body-sm text-on-surface">Excluir lesionados y sancionados</span>
                <input
                  type="checkbox"
                  checked={excludeInjured}
                  onChange={e => setExcludeInjured(e.target.checked)}
                  className="w-4 h-4 accent-primary rounded"
                />
              </label>

              <label className="flex items-center justify-between p-space-xs bg-surface-container-low rounded-lg cursor-pointer">
                <span className="text-body-sm text-body-sm text-on-surface">En gran momento (Forma &gt; 6.0)</span>
                <input
                  type="checkbox"
                  checked={highFormOnly}
                  onChange={e => setHighFormOnly(e.target.checked)}
                  className="w-4 h-4 accent-primary rounded"
                />
              </label>

              <label className="flex items-center justify-between p-space-xs bg-surface-container-low rounded-lg cursor-pointer">
                <span className="text-body-sm text-body-sm text-on-surface">Solo titulares habituales</span>
                <input
                  type="checkbox"
                  checked={onlyStarters}
                  onChange={e => setOnlyStarters(e.target.checked)}
                  className="w-4 h-4 accent-primary rounded"
                />
              </label>
            </div>
          </div>
        </div>

        {/* Footer CTAs */}
        <div className="p-space-md bg-surface-container-low border-t border-surface-container-high flex items-center gap-space-xs shrink-0">
          <button
            onClick={handleReset}
            className="px-space-md py-2.5 rounded-xl bg-surface-container-high text-on-surface-variant hover:text-on-surface font-headline-sm text-headline-sm uppercase tracking-wider transition-colors"
          >
            Restablecer
          </button>
          <button
            onClick={handleApply}
            className="flex-1 bg-primary-container text-on-primary font-headline-md text-headline-md uppercase tracking-wider py-2.5 rounded-xl shadow-lg active:scale-95 transition-transform"
          >
            Aplicar Filtros
          </button>
        </div>
      </div>
    </div>
  );
};
