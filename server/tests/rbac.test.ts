import { describe, expect, it } from 'vitest';
import createRbacService, {
  CONTENT_MANAGER_ACTIONS,
  contentManagerActionsForImport,
  isSuperAdmin,
  type AccessDecision,
  type UserAbilityLike,
} from '../src/services/rbac';
import { ARTICLE_UID, makeCollectionConfig } from './fixtures';

const EDITOR_ROLE = { id: 2, code: 'strapi-editor' };
const AUTHOR_ROLE = { id: 3, code: 'strapi-author' };
const SUPER_ROLE = { id: 1, code: 'strapi-super-admin' };

/** An ability that allows exactly the listed Content Manager actions on the given uid. */
function ability(allowed: string[], uid = ARTICLE_UID): UserAbilityLike {
  return {
    can: (action, subject) => allowed.includes(action) && (subject === undefined || subject === uid),
    cannot: (action, subject) => !(allowed.includes(action) && (subject === undefined || subject === uid)),
  };
}

const ALL_CM_ACTIONS = Object.values(CONTENT_MANAGER_ACTIONS);

interface FakeOptions {
  /** When false the plugin's own schema service rejects the uid. */
  usableCollection?: boolean;
  /** When false `permission-checker` throws and the service must fall back, not fail open. */
  checkerAvailable?: boolean;
}

function fakeStrapi(options: FakeOptions = {}) {
  const warnings: string[] = [];

  const strapi = {
    log: {
      warn: (message: string) => warnings.push(message),
      debug: () => undefined,
      error: () => undefined,
      info: () => undefined,
    },
    plugin: (name: string) => {
      if (name === 'content-manager') {
        return {
          service: () => ({
            create: ({ userAbility, model }: { userAbility: UserAbilityLike; model: string }) => {
              if (options.checkerAvailable === false) {
                throw new Error('permission-checker is gone');
              }

              const make = (action: string) => () => userAbility.can(action, model);

              return {
                can: {
                  read: make(CONTENT_MANAGER_ACTIONS.read),
                  create: make(CONTENT_MANAGER_ACTIONS.create),
                  update: make(CONTENT_MANAGER_ACTIONS.update),
                  publish: make(CONTENT_MANAGER_ACTIONS.publish),
                },
              };
            },
          }),
        };
      }

      return {
        service: () => ({
          isUsableCollection: () => options.usableCollection !== false,
        }),
      };
    },
  };

  return { strapi: strapi as never, warnings };
}

const check = async (
  overrides: Partial<Parameters<ReturnType<typeof createRbacService>['check']>[0]> = {},
  fakeOptions: FakeOptions = {}
): Promise<AccessDecision> => {
  const { strapi } = fakeStrapi(fakeOptions);
  const service = createRbacService({ strapi });

  return service.check({
    uid: ARTICLE_UID,
    operation: 'export',
    context: { user: { id: 9, roles: [EDITOR_ROLE] }, userAbility: ability(ALL_CM_ACTIONS) },
    collection: makeCollectionConfig(),
    roleGrants: { '2': { [ARTICLE_UID]: { import: true, export: true } } },
    ...overrides,
  });
};

const denialCode = (decision: AccessDecision) =>
  decision.allowed ? 'allowed' : decision.code;

describe('contentManagerActionsForImport', () => {
  it('asks for create only when rows can only be created', () => {
    expect(contentManagerActionsForImport('create-only')).toEqual([CONTENT_MANAGER_ACTIONS.create]);
    expect(contentManagerActionsForImport('skip-duplicates')).toEqual([
      CONTENT_MANAGER_ACTIONS.create,
    ]);
  });

  it('asks for update only in update-only mode', () => {
    expect(contentManagerActionsForImport('update-only')).toEqual([CONTENT_MANAGER_ACTIONS.update]);
  });

  it('asks for both in upsert mode', () => {
    expect(contentManagerActionsForImport('upsert')).toEqual([
      CONTENT_MANAGER_ACTIONS.create,
      CONTENT_MANAGER_ACTIONS.update,
    ]);
  });
});

describe('isSuperAdmin', () => {
  it('recognises the super admin role code', () => {
    expect(isSuperAdmin({ roles: [SUPER_ROLE] })).toBe(true);
    expect(isSuperAdmin({ roles: [EDITOR_ROLE] })).toBe(false);
    expect(isSuperAdmin({ roles: [] })).toBe(false);
    expect(isSuperAdmin(undefined)).toBe(false);
  });
});

describe('gate 1: the collection must be one the plugin can handle', () => {
  it('denies an unknown collection', async () => {
    expect(denialCode(await check({}, { usableCollection: false }))).toBe('unknown_collection');
  });
});

describe('gate 2: the collection allow-list', () => {
  it('denies a collection that was never enabled', async () => {
    const decision = await check({ collection: makeCollectionConfig({ enabled: false }) });

    expect(denialCode(decision)).toBe('collection_not_enabled');
  });

  it('denies export when only import is switched on', async () => {
    const decision = await check({
      operation: 'export',
      collection: makeCollectionConfig({ allowExport: false }),
    });

    expect(denialCode(decision)).toBe('operation_not_enabled');
  });

  it('denies import when only export is switched on', async () => {
    const decision = await check({
      operation: 'import',
      collection: makeCollectionConfig({ allowImport: false }),
    });

    expect(denialCode(decision)).toBe('operation_not_enabled');
  });

  it('applies the allow-list to a super admin as well', async () => {
    const decision = await check({
      context: { user: { id: 1, roles: [SUPER_ROLE] }, userAbility: ability(ALL_CM_ACTIONS) },
      collection: makeCollectionConfig({ enabled: false }),
    });

    expect(denialCode(decision)).toBe('collection_not_enabled');
  });
});

describe('gate 3: the per-role grant', () => {
  it('denies a role with no grant for the collection', async () => {
    const decision = await check({ roleGrants: {} });

    expect(denialCode(decision)).toBe('role_not_granted');
  });

  it('denies a role granted import when export was requested', async () => {
    const decision = await check({
      operation: 'export',
      roleGrants: { '2': { [ARTICLE_UID]: { import: true, export: false } } },
    });

    expect(denialCode(decision)).toBe('role_not_granted');
  });

  it('denies a grant that belongs to a different collection', async () => {
    const decision = await check({
      roleGrants: { '2': { 'api::other.other': { import: true, export: true } } },
    });

    expect(denialCode(decision)).toBe('role_not_granted');
  });

  it('allows when any one of the user roles carries the grant', async () => {
    const decision = await check({
      context: {
        user: { id: 9, roles: [AUTHOR_ROLE, EDITOR_ROLE] },
        userAbility: ability(ALL_CM_ACTIONS),
      },
      roleGrants: { '2': { [ARTICLE_UID]: { import: false, export: true } } },
    });

    expect(decision.allowed).toBe(true);
  });

  it('exempts a super admin from needing a grant', async () => {
    const decision = await check({
      context: { user: { id: 1, roles: [SUPER_ROLE] }, userAbility: ability(ALL_CM_ACTIONS) },
      roleGrants: {},
    });

    expect(decision.allowed).toBe(true);
  });

  it('denies a user with no roles at all', async () => {
    const decision = await check({
      context: { user: { id: 9, roles: [] }, userAbility: ability(ALL_CM_ACTIONS) },
    });

    expect(denialCode(decision)).toBe('role_not_granted');
  });
});

describe('gate 4: the user own Content Manager rights', () => {
  it('denies export to someone who cannot read the collection', async () => {
    const decision = await check({
      operation: 'export',
      context: { user: { id: 9, roles: [EDITOR_ROLE] }, userAbility: ability([]) },
    });

    expect(denialCode(decision)).toBe('content_manager_denied');
  });

  it('denies an upsert import to someone who can create but not update', async () => {
    const decision = await check({
      operation: 'import',
      mode: 'upsert',
      context: {
        user: { id: 9, roles: [EDITOR_ROLE] },
        userAbility: ability([CONTENT_MANAGER_ACTIONS.create]),
      },
    });

    expect(denialCode(decision)).toBe('content_manager_denied');
  });

  it('allows a create-only import to someone who can only create', async () => {
    const decision = await check({
      operation: 'import',
      mode: 'create-only',
      context: {
        user: { id: 9, roles: [EDITOR_ROLE] },
        userAbility: ability([CONTENT_MANAGER_ACTIONS.create]),
      },
    });

    expect(decision.allowed).toBe(true);
  });

  it('allows an update-only import to someone who can only update', async () => {
    const decision = await check({
      operation: 'import',
      mode: 'update-only',
      context: {
        user: { id: 9, roles: [EDITOR_ROLE] },
        userAbility: ability([CONTENT_MANAGER_ACTIONS.update]),
      },
    });

    expect(decision.allowed).toBe(true);
  });

  it('demands publish rights only when the caller says the run will publish', async () => {
    const withoutPublish = ability([
      CONTENT_MANAGER_ACTIONS.create,
      CONTENT_MANAGER_ACTIONS.update,
    ]);

    const noPublishNeeded = await check({
      operation: 'import',
      context: { user: { id: 9, roles: [EDITOR_ROLE] }, userAbility: withoutPublish },
      willPublish: false,
    });
    expect(noPublishNeeded.allowed).toBe(true);

    const publishNeeded = await check({
      operation: 'import',
      context: { user: { id: 9, roles: [EDITOR_ROLE] }, userAbility: withoutPublish },
      willPublish: true,
    });
    expect(denialCode(publishNeeded)).toBe('content_manager_denied');
  });

  it('applies gate 4 to a super admin too, so the plugin is never an escalation path', async () => {
    const decision = await check({
      operation: 'export',
      context: { user: { id: 1, roles: [SUPER_ROLE] }, userAbility: ability([]) },
    });

    expect(denialCode(decision)).toBe('content_manager_denied');
  });

  it('denies a request that carries no ability at all', async () => {
    const decision = await check({
      context: { user: { id: 9, roles: [EDITOR_ROLE] }, userAbility: undefined },
    });

    expect(denialCode(decision)).toBe('no_ability');
  });
});

describe('permission-checker fallback', () => {
  it('falls back to the ability and still denies, rather than failing open', async () => {
    const decision = await check(
      {
        operation: 'export',
        context: { user: { id: 9, roles: [EDITOR_ROLE] }, userAbility: ability([]) },
      },
      { checkerAvailable: false }
    );

    expect(denialCode(decision)).toBe('content_manager_denied');
  });

  it('falls back to the ability and allows a genuinely permitted request', async () => {
    const decision = await check(
      { operation: 'export', context: { user: { id: 9, roles: [EDITOR_ROLE] }, userAbility: ability(ALL_CM_ACTIONS) } },
      { checkerAvailable: false }
    );

    expect(decision.allowed).toBe(true);
  });

  it('warns once when the internal service is missing', async () => {
    const { strapi, warnings } = fakeStrapi({ checkerAvailable: false });
    const service = createRbacService({ strapi });

    service.createChecker(ARTICLE_UID, ability([]));

    expect(warnings.join(' ')).toContain('permission-checker');
  });
});

describe('a fully permitted request', () => {
  it('is allowed', async () => {
    expect((await check()).allowed).toBe(true);
  });
});
