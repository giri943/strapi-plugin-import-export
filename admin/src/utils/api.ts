import { getFetchClient } from '@strapi/strapi/admin';
import { PLUGIN_ID } from '../pluginId';

/** Strapi mounts plugin admin routes at `/{pluginName}/…`, not under `/admin/plugins/…`. */
const base = () => `/${PLUGIN_ID}`;

export type ColumnKind =
  | 'meta'
  | 'scalar'
  | 'json'
  | 'component'
  | 'relation'
  | 'media'
  | 'dynamiczone';

export interface ColumnDescriptor {
  header: string;
  kind: ColumnKind;
  lookupKey?: string;
  targetUid?: string;
  multiple: boolean;
  required: boolean;
  readOnly: boolean;
  hint?: string;
  attribute?: { type?: string; enum?: string[] };
}

export interface CollectionConfig {
  enabled: boolean;
  allowImport: boolean;
  allowExport: boolean;
  excludeFields: string[];
  relationLookupKeys: Record<string, string>;
  identifierField: string;
}

export interface CollectionGrant {
  import: boolean;
  export: boolean;
}

export interface PluginSettings {
  collections: Record<string, CollectionConfig>;
  roleGrants: Record<string, Record<string, CollectionGrant>>;
  csvDelimiter: string;
  multiValueDelimiter: string;
  escapeFormulas: boolean;
  includeBom: boolean;
  mediaLookupKey: string;
  defaultImportMode: ImportMode;
  maxFileSizeMb: number;
  maxRows: number;
  maxColumns: number;
  maxCellLengthKb: number;
  batchSize: number;
  templateRepeatableSlots: number;
  maxComponentDepth: number;
  jobRetentionDays: number;
}

export type ImportMode = 'create-only' | 'update-only' | 'upsert' | 'skip-duplicates';

export interface CollectionSummary {
  uid: string;
  displayName: string;
  apiId?: string;
  draftAndPublish: boolean;
  localized: boolean;
  lookupKeys: string[];
  columnCount: number;
}

export interface AdminRole {
  id: number;
  name: string;
  code: string;
  description?: string;
}

export interface SettingBound {
  min: number;
  max: number;
  default: number;
}

export interface SettingsResponse {
  settings: PluginSettings;
  candidates: CollectionSummary[];
  roles: AdminRole[];
  limits: Record<string, SettingBound>;
  options: {
    delimiters: string[];
    mediaLookupKeys: string[];
    importModes: ImportMode[];
    alwaysExcludedFields: string[];
  };
  defaults: { collection: CollectionConfig };
}

export interface CollectionDescription extends CollectionSummary {
  columns: ColumnDescriptor[];
  relationTargets: Array<{ uid: string; displayName: string; lookupKeys: string[] }>;
  unsupported: Array<{ field: string; reason: string }>;
  config: CollectionConfig;
}

export interface ColumnsResponse {
  uid: string;
  columns: ColumnDescriptor[];
  identifierField: string;
  allowImport: boolean;
  allowExport: boolean;
  defaultImportMode: ImportMode;
  multiValueDelimiter: string;
  csvDelimiter: string;
  limits: { maxFileSizeMb: number; maxRows: number; maxColumns: number };
}

export interface RowError {
  line: number;
  column?: string;
  code: string;
  message: string;
}

export interface HeaderReport {
  delimiter: string;
  recognised: string[];
  unknownColumns: Array<{ header: string; reason: string; suggestion?: string }>;
  duplicateColumns: string[];
  missingRequired: string[];
  readOnlyIgnored: string[];
  identifierColumn?: string;
}

export interface JobRecord {
  documentId: string;
  contentTypeUid: string;
  jobKind: 'dry-run' | 'import';
  jobStatus: 'queued' | 'running' | 'completed' | 'failed' | 'interrupted';
  importMode: ImportMode;
  fileName?: string;
  totalRows?: number;
  processedRows?: number;
  createdCount?: number;
  updatedCount?: number;
  skippedCount?: number;
  failedCount?: number;
  rowErrors?: RowError[];
  errorsTruncated?: boolean;
  report?: { header?: HeaderReport; aborted?: { code: string; message: string } | null };
  failureMessage?: string;
  startedAt?: string;
  finishedAt?: string;
  requestedByEmail?: string;
  createdAt?: string;
}

export interface StartImportResponse {
  jobId: string;
  dryRun: boolean;
  mode: ImportMode;
  fileName: string;
}

function shorten(message: string): string {
  const text = message.trim();
  if (text.startsWith('<!') || text.toLowerCase().includes('<!doctype')) {
    return 'The server returned HTML instead of JSON. Check that you are signed in.';
  }

  return text.length > 300 ? `${text.slice(0, 300)}…` : text;
}

function messageFromBody(data: unknown): string | undefined {
  if (!data || typeof data !== 'object') return undefined;

  const body = data as Record<string, unknown>;
  const error = body.error;

  if (error && typeof error === 'object') {
    const inner = error as Record<string, unknown>;
    if (typeof inner.message === 'string') return inner.message;
  }
  if (typeof body.message === 'string') return body.message;

  return undefined;
}

export function unwrapError(error: unknown): string {
  if (error && typeof error === 'object') {
    const candidate = error as Record<string, unknown>;
    const response = candidate.response as Record<string, unknown> | undefined;

    const fromBody = messageFromBody(response?.data);
    if (fromBody) return shorten(fromBody);

    if (typeof candidate.message === 'string') return shorten(candidate.message);
  }
  if (error instanceof Error && error.message) return shorten(error.message);

  return 'The request failed.';
}

export async function fetchSettings(): Promise<SettingsResponse> {
  const { get } = getFetchClient();

  try {
    const { data } = await get(`${base()}/settings`);
    return data as SettingsResponse;
  } catch (error) {
    throw new Error(unwrapError(error));
  }
}

export async function saveSettings(patch: Partial<PluginSettings>): Promise<PluginSettings> {
  const { put } = getFetchClient();

  try {
    const { data } = await put(`${base()}/settings`, patch);
    return (data as { settings: PluginSettings }).settings;
  } catch (error) {
    throw new Error(unwrapError(error));
  }
}

export async function fetchCollectionDescription(uid: string): Promise<CollectionDescription> {
  const { get } = getFetchClient();

  try {
    const { data } = await get(`${base()}/settings/collections/${encodeURIComponent(uid)}`);
    return data as CollectionDescription;
  } catch (error) {
    throw new Error(unwrapError(error));
  }
}

export async function fetchColumns(uid: string): Promise<ColumnsResponse> {
  const { get } = getFetchClient();

  try {
    const { data } = await get(`${base()}/content/${encodeURIComponent(uid)}/columns`);
    return data as ColumnsResponse;
  } catch (error) {
    throw new Error(unwrapError(error));
  }
}

export async function startImport(
  uid: string,
  file: File,
  options: { mode: ImportMode; locale?: string; dryRun: boolean }
): Promise<StartImportResponse> {
  const { post } = getFetchClient();

  const form = new FormData();
  form.append('file', file);
  form.append('mode', options.mode);
  if (options.locale) form.append('locale', options.locale);

  const path = options.dryRun ? 'import/dry-run' : 'import';

  try {
    const { data } = await post(`${base()}/content/${encodeURIComponent(uid)}/${path}`, form);
    return data as StartImportResponse;
  } catch (error) {
    throw new Error(unwrapError(error));
  }
}

export async function fetchJob(jobId: string): Promise<JobRecord> {
  const { get } = getFetchClient();

  try {
    const { data } = await get(`${base()}/jobs/${encodeURIComponent(jobId)}`);
    return data as JobRecord;
  } catch (error) {
    throw new Error(unwrapError(error));
  }
}

export async function fetchJobs(options: {
  uid?: string;
  page?: number;
  pageSize?: number;
}): Promise<{ results: JobRecord[]; total: number; page: number; pageSize: number }> {
  const { get } = getFetchClient();

  const params = new URLSearchParams();
  if (options.uid) params.set('uid', options.uid);
  params.set('page', String(options.page ?? 1));
  params.set('pageSize', String(options.pageSize ?? 20));

  try {
    const { data } = await get(`${base()}/jobs?${params.toString()}`);
    return data as { results: JobRecord[]; total: number; page: number; pageSize: number };
  } catch (error) {
    throw new Error(unwrapError(error));
  }
}


