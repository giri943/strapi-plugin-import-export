export const PLUGIN_NAME = 'strapi-import-export' as const;
export const SETTINGS_STORE_KEY = 'settings' as const;

export const MEDIA_UID = 'plugin::upload.file' as const;
export const IMPORT_JOB_UID = `plugin::${PLUGIN_NAME}.import-job` as const;

/**
 * Content types the plugin refuses to expose even when an administrator adds them to the
 * allow-list. They hold credentials, tokens and the RBAC tables themselves, so a CSV round trip
 * is either a credential leak or a privilege escalation.
 */
export const BLOCKED_CONTENT_TYPES: readonly string[] = [
  'admin::user',
  'admin::role',
  'admin::permission',
  'admin::api-token',
  'admin::api-token-permission',
  'admin::transfer-token',
  'admin::transfer-token-permission',
  'plugin::users-permissions.user',
  'plugin::users-permissions.role',
  'plugin::users-permissions.permission',
  'plugin::upload.file',
  'plugin::upload.folder',
  'plugin::i18n.locale',
  'plugin::review-workflows.workflow',
  'plugin::review-workflows.workflow-stage',
  IMPORT_JOB_UID,
];

/** Attribute names never written to a CSV, whatever the schema says about them. */
export const BLOCKED_ATTRIBUTE_NAMES: readonly string[] = [
  'password',
  'resetPasswordToken',
  'registrationToken',
  'confirmationToken',
  'accessKey',
  'refreshToken',
];

export const JOB_STATUS = {
  queued: 'queued',
  running: 'running',
  completed: 'completed',
  failed: 'failed',
  interrupted: 'interrupted',
} as const;

export type JobStatus = (typeof JOB_STATUS)[keyof typeof JOB_STATUS];

export const JOB_KIND = {
  dryRun: 'dry-run',
  import: 'import',
} as const;

export type JobKind = (typeof JOB_KIND)[keyof typeof JOB_KIND];

/** A job whose heartbeat is older than this is assumed to have died with its process. */
export const JOB_HEARTBEAT_INTERVAL_MS = 15_000;
export const JOB_STALE_AFTER_MS = 90_000;
