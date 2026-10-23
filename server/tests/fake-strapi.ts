import {
  ARTICLE_UID,
  AUTHOR_UID,
  TAG_UID,
  articleSchema,
  authorSchema,
  ctaComponent,
  faqComponent,
  heroComponent,
  seoComponent,
  tagSchema,
} from './fixtures';

export interface SeedDocument {
  documentId: string;
  [key: string]: unknown;
}

export interface MediaFile {
  id: number;
  name: string;
  url?: string;
  hash?: string;
}

export interface WriteRecord {
  kind: 'create' | 'update' | 'publish';
  uid: string;
  documentId?: string;
  data?: Record<string, unknown>;
  locale?: string;
  status?: string;
}

export interface FakeStrapiOptions {
  documents?: Record<string, SeedDocument[]>;
  media?: MediaFile[];
  /** Row data that should make the write throw, keyed by the value of `title`. */
  rejectTitles?: string[];
  /** Makes every write in a multi-row transaction fail, to exercise the per-row retry. */
  failBatchedTransactions?: boolean;
}

export function createFakeStrapi(options: FakeStrapiOptions = {}) {
  const store: Record<string, SeedDocument[]> = {
    [ARTICLE_UID]: [],
    [AUTHOR_UID]: [],
    [TAG_UID]: [],
    ...(options.documents ?? {}),
  };

  const media = options.media ?? [];
  const writes: WriteRecord[] = [];
  const logs: string[] = [];
  const rejectTitles = new Set(options.rejectTitles ?? []);

  let nextDocumentId = 1;

  const matches = (row: SeedDocument, filters: Record<string, unknown> | undefined): boolean => {
    if (!filters) return true;

    return Object.entries(filters).every(([field, condition]) => {
      if (condition && typeof condition === 'object' && '$in' in condition) {
        const wanted = (condition as { $in: unknown[] }).$in.map(String);
        return wanted.includes(String(row[field]));
      }
      return String(row[field]) === String(condition);
    });
  };

  const documentsApi = (uid: string) => ({
    async findMany(params: Record<string, unknown> = {}) {
      const rows = store[uid] ?? [];
      const filtered = rows.filter((row) =>
        matches(row, params.filters as Record<string, unknown> | undefined)
      );
      const limit = typeof params.limit === 'number' ? params.limit : filtered.length;
      const start = typeof params.start === 'number' ? params.start : 0;

      return filtered.slice(start, start + limit);
    },

    async count(params: Record<string, unknown> = {}) {
      const rows = store[uid] ?? [];
      return rows.filter((row) => matches(row, params.filters as Record<string, unknown> | undefined))
        .length;
    },

    async create(params: { data: Record<string, unknown>; locale?: string; status?: string }) {
      const title = String(params.data?.title ?? '');
      if (rejectTitles.has(title)) {
        throw new Error(`database rejected "${title}"`);
      }

      const documentId = `doc-${nextDocumentId}`;
      nextDocumentId += 1;

      const row: SeedDocument = { documentId, ...params.data };
      store[uid] = [...(store[uid] ?? []), row];

      writes.push({
        kind: 'create',
        uid,
        documentId,
        data: params.data,
        locale: params.locale,
        status: params.status,
      });

      return row;
    },

    async update(params: { documentId: string; data: Record<string, unknown>; locale?: string }) {
      const title = String(params.data?.title ?? '');
      if (rejectTitles.has(title)) {
        throw new Error(`database rejected "${title}"`);
      }

      const rows = store[uid] ?? [];
      const index = rows.findIndex((row) => row.documentId === params.documentId);
      if (index >= 0) {
        rows[index] = { ...rows[index], ...params.data };
      }

      writes.push({
        kind: 'update',
        uid,
        documentId: params.documentId,
        data: params.data,
        locale: params.locale,
      });

      return rows[index];
    },

    async publish(params: { documentId: string; locale?: string }) {
      writes.push({ kind: 'publish', uid, documentId: params.documentId, locale: params.locale });
      return { documentId: params.documentId };
    },
  });

  const strapi = {
    contentTypes: {
      [ARTICLE_UID]: articleSchema,
      [AUTHOR_UID]: authorSchema,
      [TAG_UID]: tagSchema,
    },
    components: {
      'shared.seo': seoComponent,
      'shared.faq': faqComponent,
      'blocks.hero': heroComponent,
      'blocks.cta': ctaComponent,
    },
    log: {
      info: (message: string) => logs.push(message),
      warn: (message: string) => logs.push(message),
      error: (message: string) => logs.push(message),
      debug: (message: string) => logs.push(message),
    },
    documents: (uid: string) => documentsApi(uid),
    db: {
      /**
       * Snapshots the store and restores it when the callback throws.
       *
       * Rollback has to be modelled for the import service's batch-then-retry path to be
       * testable at all: without it, rows written before the failing row survive and the retry
       * writes them a second time.
       */
      async transaction<T>(work: () => Promise<T>): Promise<T> {
        const snapshot = Object.fromEntries(
          Object.entries(store).map(([uid, rows]) => [uid, rows.map((row) => ({ ...row }))])
        );
        const writeMark = writes.length;

        const restore = () => {
          for (const uid of Object.keys(store)) delete store[uid];
          Object.assign(store, snapshot);
          writes.length = writeMark;
        };

        if (options.failBatchedTransactions) {
          await work().catch(() => undefined);
          restore();
          throw new Error('transaction aborted');
        }

        try {
          return await work();
        } catch (error) {
          restore();
          throw error;
        }
      },
      query: (uid: string) => ({
        async findMany(params: { where?: Record<string, unknown>; select?: string[] }) {
          if (uid !== 'plugin::upload.file') return [];

          const where = params.where ?? {};
          const [field, condition] = Object.entries(where)[0] ?? [];
          if (!field) return media;

          const wanted =
            condition && typeof condition === 'object' && '$in' in condition
              ? (condition as { $in: unknown[] }).$in.map(String)
              : [String(condition)];

          return media.filter((file) =>
            wanted.includes(String((file as unknown as Record<string, unknown>)[field]))
          );
        },
      }),
    },
  };

  return {
    strapi: strapi as never,
    store,
    writes,
    logs,
    created: () => writes.filter((write) => write.kind === 'create'),
    updated: () => writes.filter((write) => write.kind === 'update'),
    published: () => writes.filter((write) => write.kind === 'publish'),
  };
}
