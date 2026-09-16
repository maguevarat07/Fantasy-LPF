import React from 'react';
import { lpfDataService } from '../../services/lpfDataService';

interface CanonicalDataModalProps {
  onClose: () => void;
}

export const CanonicalDataModal: React.FC<CanonicalDataModalProps> = ({ onClose }) => {
  const report = lpfDataService.getCompletenessReport();
  const sources = [
    { name: 'LPF Oficial', role: 'Plantillas y calendario', status: report.sourcesStatus.LPF },
    { name: 'Transfermarkt', role: 'Inscripciones, plantillas, fotos y cambios de club', status: report.sourcesStatus.TRANSFERMARKT },
    { name: 'Soccerway', role: 'Contraste de partidos y eventos', status: report.sourcesStatus.SOCCERWAY },
    { name: '365Scores', role: 'Contraste de eventos', status: report.sourcesStatus['365SCORES'] },
    { name: 'FotMob', role: 'Contraste de partidos y alineaciones', status: report.sourcesStatus.FOTMOB }
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-surface-container-lowest/85 backdrop-blur-md px-gutter-mobile pb-safe">
      <div className="flex flex-col w-full max-w-lg bg-surface-container rounded-t-2xl sm:rounded-2xl shadow-2xl overflow-hidden border border-surface-container-high/60 max-h-[90vh]">
        {/* Header */}
        <div className="p-space-md bg-surface-container-low flex items-center justify-between border-b border-surface-container-high">
          <div className="flex items-center gap-space-xs">
            <span className="material-symbols-outlined text-primary text-[24px]">verified_user</span>
            <div className="flex flex-col">
              <h2 className="font-headline-lg text-headline-lg uppercase text-on-surface leading-none">
                Pipeline Canónico de Datos
              </h2>
              <span className="font-label-sm text-label-sm text-on-surface-variant mt-0.5">
                Arquitectura de Conciliación Multi-Fuente (Master Plan §5)
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

        {/* Content */}
        <div className="p-space-md overflow-y-auto space-y-space-md flex-1">
          <div className="bg-surface-container-low p-space-sm rounded-xl space-y-space-2xs shadow-inner">
            <div className="flex items-center justify-between">
              <span className="font-headline-sm text-headline-sm uppercase text-on-surface">
                Estado del Motor de Conciliación
              </span>
              <span className="bg-primary/20 text-primary font-label-sm text-label-sm font-bold px-2 py-0.5 rounded-full">
                {report.status || 'NO VERIFICADO'}
              </span>
            </div>
            <p className="text-body-sm text-body-sm text-on-surface-variant">
              {report.message || 'El estado se obtiene del catálogo persistido y nunca se declara completo sin evidencia.'}
            </p>
          </div>

          <div className="space-y-space-xs">
            <span className="font-headline-sm text-headline-sm uppercase text-on-surface tracking-wider">
              Fuentes en Tiempo Real
            </span>
            <div className="space-y-space-2xs">
              {sources.map((s, idx) => (
                <div key={idx} className="p-space-xs bg-surface-container-low rounded-lg flex items-center justify-between">
                  <div className="flex flex-col">
                    <span className="font-title-md text-title-md text-on-surface">{s.name}</span>
                    <span className="font-body-sm text-body-sm text-on-surface-variant">{s.role}</span>
                  </div>
                  <div className="flex flex-col items-end">
                    <span className="text-[10px] text-on-surface-variant font-mono">{s.status}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="p-space-sm bg-surface-container-low rounded-xl space-y-1">
            <span className="font-headline-sm text-headline-sm uppercase text-secondary tracking-wider">
              Resolución de Disputas
            </span>
            <p className="text-body-sm text-body-sm text-on-surface-variant leading-relaxed">
              Cualquier discrepancia de autoría de gol o tarjeta entre medios se congela automáticamente y se resuelve conforme al acta arbitral certificada de la Fepafut.
            </p>
          </div>
        </div>

        {/* Footer */}
        <div className="p-space-md bg-surface-container-low border-t border-surface-container-high flex justify-end shrink-0">
          <button
            onClick={onClose}
            className="w-full bg-primary-container text-on-primary font-headline-md text-headline-md uppercase tracking-wider py-2.5 rounded-xl shadow-lg active:scale-95 transition-transform"
          >
            Entendido
          </button>
        </div>
      </div>
    </div>
  );
};
