import type { AdapterResult, NormalizedEntity, Source, SourceObservation, SourceStatus } from './types.ts';

export interface SourceAdapter {
  readonly source: Source;
  readonly parserVersion: string;
  collect(): Promise<AdapterResult>;
}

export function buildResult(input: {
  source: Source;
  parserVersion: string;
  startedAt: string;
  urls: string[];
  entities?: NormalizedEntity[];
  observations?: SourceObservation[];
  warnings?: string[];
  errors?: string[];
  httpStatuses?: number[];
  blocked?: boolean;
}): AdapterResult {
  const entities = input.entities ?? [];
  const errors = input.errors ?? [];
  let status: SourceStatus;
  if (input.blocked) status = 'BLOCKED';
  else if (errors.length && !entities.length) status = 'NOT_VERIFIED';
  else if (entities.length && (errors.length || (input.warnings?.length ?? 0) > 0)) status = 'PARTIAL';
  else if (entities.length) status = 'WORKING';
  else status = 'NOT_VERIFIED';
  return {
    source: input.source,
    parserVersion: input.parserVersion,
    startedAt: input.startedAt,
    finishedAt: new Date().toISOString(),
    sourceUrls: input.urls,
    entities,
    observations: input.observations ?? [],
    warnings: input.warnings ?? [],
    errors,
    httpStatuses: input.httpStatuses ?? [],
    status,
  };
}
