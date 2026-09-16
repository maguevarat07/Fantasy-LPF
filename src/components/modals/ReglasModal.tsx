import React from 'react';

interface ReglasModalProps {
  onClose: () => void;
}

export const ReglasModal: React.FC<ReglasModalProps> = ({ onClose }) => {
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-surface-container-lowest/85 backdrop-blur-md px-gutter-mobile pb-safe">
      <div className="flex flex-col w-full max-w-lg bg-surface-container rounded-t-2xl sm:rounded-2xl shadow-2xl overflow-hidden border border-surface-container-high/60 max-h-[90vh]">
        {/* Header */}
        <div className="p-space-md bg-surface-container-low flex items-center justify-between border-b border-surface-container-high">
          <div className="flex items-center gap-space-xs">
            <span className="material-symbols-outlined text-primary text-[24px]">gavel</span>
            <div className="flex flex-col">
              <h2 className="font-headline-lg text-headline-lg uppercase text-on-surface leading-none">
                Sistema Oficial de Puntuación
              </h2>
              <span className="font-label-sm text-label-sm text-on-surface-variant mt-0.5">
                Reglamento Canónico Master Plan LPF
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

        {/* Rules Table */}
        <div className="p-space-md overflow-y-auto space-y-space-md flex-1">
          <div className="space-y-space-2xs">
            <span className="font-headline-sm text-headline-sm uppercase text-primary tracking-wider">
              Participación y Minutos
            </span>
            <div className="bg-surface-container-low p-space-xs rounded-lg space-y-1 text-body-sm text-body-sm text-on-surface">
              <div className="flex justify-between">
                <span>Jugar al menos 60 minutos (sin contar descuento)</span>
                <span className="font-bold text-primary">+2 pts</span>
              </div>
              <div className="flex justify-between">
                <span>Jugar entre 1 y 59 minutos</span>
                <span className="font-bold text-primary">+1 pt</span>
              </div>
            </div>
          </div>

          <div className="space-y-space-2xs">
            <span className="font-headline-sm text-headline-sm uppercase text-secondary tracking-wider">
              Goles y Ofensiva
            </span>
            <div className="bg-surface-container-low p-space-xs rounded-lg space-y-1 text-body-sm text-body-sm text-on-surface">
              <div className="flex justify-between">
                <span>Gol anotado por Delantero (DEL)</span>
                <span className="font-bold text-primary">+4 pts</span>
              </div>
              <div className="flex justify-between">
                <span>Gol anotado por Centrocampista (MED)</span>
                <span className="font-bold text-primary">+5 pts</span>
              </div>
              <div className="flex justify-between">
                <span>Gol anotado por Defensa (DEF) o Portero (POR)</span>
                <span className="font-bold text-primary">+6 pts</span>
              </div>
              <div className="flex justify-between">
                <span>Asistencia de gol oficial</span>
                <span className="font-bold text-primary">+3 pts</span>
              </div>
              <div className="flex justify-between">
                <span>MVP del Partido oficial de la LPF</span>
                <span className="font-bold text-amber-400">+3 pts</span>
              </div>
            </div>
          </div>

          <div className="space-y-space-2xs">
            <span className="font-headline-sm text-headline-sm uppercase text-on-surface-variant tracking-wider">
              Defensiva y Portería
            </span>
            <div className="bg-surface-container-low p-space-xs rounded-lg space-y-1 text-body-sm text-body-sm text-on-surface">
              <div className="flex justify-between">
                <span>Valla invicta POR o DEF (jugando al menos 60 mins)</span>
                <span className="font-bold text-primary">+4 pts</span>
              </div>
              <div className="flex justify-between">
                <span>Valla invicta MED (jugando al menos 60 mins)</span>
                <span className="font-bold text-primary">+1 pt</span>
              </div>
              <div className="flex justify-between">
                <span>Penalti parado por el Portero</span>
                <span className="font-bold text-primary">+5 pts</span>
              </div>
              <div className="flex justify-between">
                <span>Por cada 2 goles recibidos (POR o DEF)</span>
                <span className="font-bold text-error">-1 pt</span>
              </div>
            </div>
          </div>

          <div className="space-y-space-2xs">
            <span className="font-headline-sm text-headline-sm uppercase text-error tracking-wider">
              Sanciones y Disciplina
            </span>
            <div className="bg-surface-container-low p-space-xs rounded-lg space-y-1 text-body-sm text-body-sm text-on-surface">
              <div className="flex justify-between">
                <span>Tarjeta Amarilla</span>
                <span className="font-bold text-error">-1 pt</span>
              </div>
              <div className="flex justify-between">
                <span>Tarjeta Roja (directa o doble amarilla)</span>
                <span className="font-bold text-error">-3 pts</span>
              </div>
              <div className="flex justify-between">
                <span>Autogol</span>
                <span className="font-bold text-error">-2 pts</span>
              </div>
              <div className="flex justify-between">
                <span>Penalti fallado</span>
                <span className="font-bold text-error">-2 pts</span>
              </div>
            </div>
          </div>

          {/* Master Plan Rule Note */}
          <div className="bg-surface-container-low/70 p-space-xs rounded-lg border border-surface-container-high">
            <p className="text-[11px] text-on-surface-variant leading-relaxed">
              <strong>Regla Canónica:</strong> No se otorgan puntos por paradas de portero ni niveles fraccionados de minutos, garantizando fidelidad a las hojas de datos oficiales de la Liga Panameña de Fútbol.
            </p>
          </div>
        </div>

        {/* Footer */}
        <div className="p-space-md bg-surface-container-low border-t border-surface-container-high flex justify-end shrink-0">
          <button
            onClick={onClose}
            className="w-full bg-primary-container text-on-primary font-headline-md text-headline-md uppercase tracking-wider py-2.5 rounded-xl shadow-lg active:scale-95 transition-transform"
          >
            Cerrar Reglamento
          </button>
        </div>
      </div>
    </div>
  );
};
