import React, { useState } from 'react';
import { lpfDataService, CompletenessReport } from '../../services/lpfDataService';
import { X, RefreshCw, CheckCircle, Database, Shield, Radio, Check, AlertCircle } from 'lucide-react';

interface CanonicalAuditModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const CanonicalAuditModal: React.FC<CanonicalAuditModalProps> = ({ isOpen, onClose }) => {
  const [report, setReport] = useState<CompletenessReport>(() => lpfDataService.getCompletenessReport());
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncFeedback, setSyncFeedback] = useState<string | null>(null);

  const observations = lpfDataService.getSourceObservations();

  if (!isOpen) return null;

  const handleRunSync = async () => {
    setIsSyncing(true);
    setSyncFeedback(null);
    try {
      const updated = await lpfDataService.syncCanonicalData();
      setReport(updated);
      setSyncFeedback(updated.message || 'Catálogo canónico recargado desde el servidor.');
    } catch (error) {
      setSyncFeedback(error instanceof Error ? error.message : 'No se pudo recargar el catálogo.');
    } finally { setIsSyncing(false); }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-200">
      <div className="w-full max-w-2xl bg-[#161b22] border border-white/10 rounded-3xl shadow-2xl overflow-hidden flex flex-col text-white max-h-[85vh]">
        {/* Header */}
        <div className="p-6 pb-4 border-b border-white/10 flex items-center justify-between bg-gradient-to-b from-white/[0.04] to-transparent">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400">
              <Database className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-extrabold tracking-wide uppercase">
                Auditoría de Ingestión Canónica LPF
              </h2>
              <p className="text-xs text-zinc-400">
                Verificación de integridad de clubes, jugadores y fuentes externas
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full bg-white/5 hover:bg-white/10 flex items-center justify-center text-zinc-400 hover:text-white transition-all cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content Body */}
        <div className="p-6 overflow-y-auto space-y-6">
          {syncFeedback && (
            <div className="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 text-xs flex items-center gap-2">
              <Check className="w-4 h-4 text-emerald-400 shrink-0" />
              <span>{syncFeedback}</span>
            </div>
          )}

          {/* KPI Metrics */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="p-3.5 rounded-2xl bg-black/40 border border-white/5">
              <span className="text-[10px] uppercase font-bold text-zinc-400 block">Clubes LPF</span>
              <span className="text-xl font-black text-emerald-400">{report.clubsDetected} / 12</span>
              <span className="text-[10px] text-zinc-500 block mt-0.5">Estado: {report.status || 'NO VERIFICADO'}</span>
            </div>

            <div className="p-3.5 rounded-2xl bg-black/40 border border-white/5">
              <span className="text-[10px] uppercase font-bold text-zinc-400 block">Jugadores Totales</span>
              <span className="text-xl font-black text-white">{report.totalPlayers}</span>
              <span className="text-[10px] text-emerald-400 block mt-0.5">Activos: {report.activePlayers}</span>
            </div>

            <div className="p-3.5 rounded-2xl bg-black/40 border border-white/5">
              <span className="text-[10px] uppercase font-bold text-zinc-400 block">Con Precio</span>
              <span className="text-xl font-black text-teal-400">{report.playersWithPrice}</span>
              <span className="text-[10px] text-zinc-500 block mt-0.5">Sin precio: {report.playersWithoutPrice}</span>
            </div>

            <div className="p-3.5 rounded-2xl bg-black/40 border border-white/5">
              <span className="text-[10px] uppercase font-bold text-zinc-400 block">Conflictos</span>
              <span className="text-xl font-black text-zinc-300">{report.identityConflicts}</span>
              <span className="text-[10px] text-zinc-500 block mt-0.5">Duplicados: {report.potentialDuplicates}</span>
            </div>
          </div>

          {/* External Adapters Pipeline */}
          <div className="space-y-3">
            <h3 className="text-xs font-bold uppercase tracking-wider text-zinc-400 flex items-center gap-2">
              <Radio className="w-3.5 h-3.5 text-emerald-400" />
              <span>Estado de Fuentes Externas (Ingestion Pipeline)</span>
            </h3>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
              {Object.entries(report.sourcesStatus).map(([source, status]) => (
                <div
                  key={source}
                  className="p-3 rounded-xl bg-black/30 border border-white/5 flex items-center justify-between"
                >
                  <span className="text-xs font-bold text-zinc-300">{source}</span>
                  <span className={`px-2 py-0.5 rounded text-[10px] font-black ${
                    status === 'WORKING'
                      ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                      : 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                  }`}>
                    {status}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Source Observations / Reconciliation */}
          <div className="space-y-3">
            <h3 className="text-xs font-bold uppercase tracking-wider text-zinc-400 flex items-center gap-2">
              <Shield className="w-3.5 h-3.5 text-teal-400" />
              <span>Muestras de Conciliación & Observaciones Reales</span>
            </h3>

            <div className="space-y-2">
              {observations.map(obs => (
                <div
                  key={obs.id}
                  className="p-3 rounded-xl bg-black/40 border border-white/5 flex flex-col sm:flex-row sm:items-center justify-between gap-2"
                >
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] font-bold text-emerald-400 bg-emerald-500/10 px-1.5 py-0.5 rounded">
                        {obs.source}
                      </span>
                      <span className="text-xs font-bold text-white">{obs.entityName}</span>
                    </div>
                    <p className="text-[11px] text-zinc-400 mt-0.5">
                      {obs.rawValue} → <strong className="text-zinc-200">{obs.normalizedValue}</strong>
                    </p>
                  </div>
                  <span className={`self-start sm:self-center px-2 py-0.5 rounded text-[10px] font-black ${
                    obs.status === 'CONFIRMED'
                      ? 'bg-emerald-500/20 text-emerald-300'
                      : 'bg-amber-500/20 text-amber-300'
                  }`}>
                    {obs.status}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-white/10 bg-black/20 flex items-center justify-between">
          <span className="text-[11px] text-zinc-500">
            Última sync: {report.lastSyncTimestamp ? new Date(report.lastSyncTimestamp).toLocaleString() : 'sin ejecución registrada'}
          </span>
          <button
            onClick={handleRunSync}
            disabled={isSyncing}
            className="px-4 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-black font-bold text-xs uppercase tracking-wider transition-all cursor-pointer flex items-center gap-2 disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isSyncing ? 'animate-spin' : ''}`} />
            <span>{isSyncing ? 'Consultando...' : 'Actualizar reporte'}</span>
          </button>
        </div>
      </div>
    </div>
  );
};
