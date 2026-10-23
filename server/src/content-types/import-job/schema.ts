/**
 * `status` and `locale` are reserved attribute names in Strapi, which is why the equivalent
 * columns here are `jobStatus` and `localeCode`.
 */
export default {
  kind: 'collectionType',
  collectionName: 'import_export_jobs',
  info: {
    singularName: 'import-job',
    pluralName: 'import-jobs',
    displayName: 'Import job',
    description: 'One run of a CSV validation or import, with its progress and result.',
  },
  options: {
    draftAndPublish: false,
    comment: '',
  },
  pluginOptions: {
    'content-api': { exposed: false },
    'content-manager': { visible: false },
    i18n: { localized: false },
  },
  attributes: {
    contentTypeUid: {
      type: 'string',
      required: true,
    },
    jobKind: {
      type: 'enumeration',
      enum: ['dry-run', 'import'],
      required: true,
      default: 'dry-run',
    },
    jobStatus: {
      type: 'enumeration',
      enum: ['queued', 'running', 'completed', 'failed', 'interrupted'],
      required: true,
      default: 'queued',
    },
    importMode: {
      type: 'enumeration',
      enum: ['create-only', 'update-only', 'upsert', 'skip-duplicates'],
      required: true,
      default: 'upsert',
    },
    fileName: {
      type: 'string',
    },
    fileSizeBytes: {
      type: 'biginteger',
    },
    localeCode: {
      type: 'string',
    },
    totalRows: {
      type: 'integer',
      default: 0,
    },
    processedRows: {
      type: 'integer',
      default: 0,
    },
    createdCount: {
      type: 'integer',
      default: 0,
    },
    updatedCount: {
      type: 'integer',
      default: 0,
    },
    skippedCount: {
      type: 'integer',
      default: 0,
    },
    failedCount: {
      type: 'integer',
      default: 0,
    },
    /** Capped list of row errors. `errorsTruncated` records whether entries were dropped. */
    rowErrors: {
      type: 'json',
    },
    errorsTruncated: {
      type: 'boolean',
      default: false,
    },
    /** Header validation outcome plus the resolved options the run actually used. */
    report: {
      type: 'json',
    },
    failureMessage: {
      type: 'text',
    },
    startedAt: {
      type: 'datetime',
    },
    finishedAt: {
      type: 'datetime',
    },
    /** Admin user id, kept as a plain number so the job table does not depend on admin::user. */
    requestedById: {
      type: 'integer',
    },
    requestedByEmail: {
      type: 'string',
    },
    /** Identifies the process that owns the run, so two instances cannot claim the same job. */
    claimedBy: {
      type: 'string',
    },
    heartbeatAt: {
      type: 'datetime',
    },
  },
};
