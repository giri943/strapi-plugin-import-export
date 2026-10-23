import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Accordion,
  Alert,
  Box,
  Button,
  Checkbox,
  Divider,
  Field,
  Flex,
  Loader,
  Main,
  SingleSelect,
  SingleSelectOption,
  Switch,
  Table,
  Tbody,
  Td,
  Th,
  Thead,
  Tr,
  Typography,
} from '@strapi/design-system';
import { Check } from '@strapi/icons';
import { Layouts, Page, useNotification, useRBAC } from '@strapi/strapi/admin';
import pluginPermissions, { RBAC_FLAGS, type AllowedActions } from '../permissions';
import {
  fetchSettings,
  saveSettings,
  type CollectionConfig,
  type CollectionSummary,
  type ImportMode,
  type PluginSettings,
  type SettingsResponse,
} from '../utils/api';

const DELIMITER_LABELS: Record<string, string> = {
  ',': 'Comma  ,',
  ';': 'Semicolon  ;',
  '\t': 'Tab',
  '|': 'Pipe  |',
};

const MODE_LABELS: Record<ImportMode, string> = {
  upsert: 'Update matching entries, create the rest',
  'create-only': 'Only create',
  'update-only': 'Only update',
  'skip-duplicates': 'Create new, skip existing',
};

const LOCKED: CollectionConfig = {
  enabled: false,
  allowImport: false,
  allowExport: false,
  excludeFields: [],
  relationLookupKeys: {},
  identifierField: 'documentId',
};

const SettingsPage = () => {
  const { toggleNotification } = useNotification();
  const { isLoading: rbacLoading, allowedActions } = useRBAC([
    ...pluginPermissions.readConfig,
    ...pluginPermissions.updateConfig,
  ]);

  const [data, setData] = useState<SettingsResponse | null>(null);
  const [draft, setDraft] = useState<PluginSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canEdit = Boolean((allowedActions as AllowedActions)[RBAC_FLAGS.updateConfig]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const response = await fetchSettings();
      setData(response);
      setDraft(response.settings);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not load the configuration.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!rbacLoading) void load();
  }, [rbacLoading, load]);

  const collectionOf = useCallback(
    (uid: string): CollectionConfig => draft?.collections[uid] ?? LOCKED,
    [draft]
  );

  const patchCollection = (uid: string, patch: Partial<CollectionConfig>) => {
    setDraft((current) => {
      if (!current) return current;

      const existing = current.collections[uid] ?? LOCKED;
      const next: CollectionConfig = { ...existing, ...patch };

      // An operation cannot stay switched on for a collection that is being switched off, or the
      // saved shape would claim an access the server then refuses.
      if (next.enabled === false) {
        next.allowImport = false;
        next.allowExport = false;
      }

      return { ...current, collections: { ...current.collections, [uid]: next } };
    });
  };

  const patchGrant = (roleId: number, uid: string, patch: { import?: boolean; export?: boolean }) => {
    setDraft((current) => {
      if (!current) return current;

      const forRole = current.roleGrants[String(roleId)] ?? {};
      const existing = forRole[uid] ?? { import: false, export: false };

      return {
        ...current,
        roleGrants: {
          ...current.roleGrants,
          [String(roleId)]: { ...forRole, [uid]: { ...existing, ...patch } },
        },
      };
    });
  };

  const enabledCollections = useMemo(() => {
    if (!data || !draft) return [];

    return data.candidates.filter((candidate) => draft.collections[candidate.uid]?.enabled);
  }, [data, draft]);

  const save = async () => {
    if (!draft) return;

    setSaving(true);
    setError(null);

    try {
      const saved = await saveSettings({
        collections: draft.collections,
        roleGrants: draft.roleGrants,
        csvDelimiter: draft.csvDelimiter,
        multiValueDelimiter: draft.multiValueDelimiter,
        escapeFormulas: draft.escapeFormulas,
        includeBom: draft.includeBom,
        mediaLookupKey: draft.mediaLookupKey,
        defaultImportMode: draft.defaultImportMode,
        maxFileSizeMb: draft.maxFileSizeMb,
        maxRows: draft.maxRows,
        batchSize: draft.batchSize,
        templateRepeatableSlots: draft.templateRepeatableSlots,
        jobRetentionDays: draft.jobRetentionDays,
      });

      setDraft(saved);
      toggleNotification({ type: 'success', message: 'Configuration saved.' });
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'Could not save.';
      setError(message);
      toggleNotification({ type: 'danger', message });
    } finally {
      setSaving(false);
    }
  };

  if (rbacLoading) return <Page.Loading />;

  return (
    <Page.Protect permissions={pluginPermissions.readConfig}>
      <Main>
        <Layouts.Header
          title="CSV Import & Export"
          subtitle="Choose which collections can be imported or exported, and which roles may do it."
          primaryAction={
            canEdit ? (
              <Button startIcon={<Check />} onClick={save} loading={saving} disabled={!draft}>
                Save
              </Button>
            ) : null
          }
        />

        <Layouts.Content>
          <Flex direction="column" alignItems="stretch" gap={6}>
            {error ? (
              <Alert
                closeLabel="Close"
                onClose={() => setError(null)}
                title="Something went wrong"
                variant="danger"
              >
                {error}
              </Alert>
            ) : null}

            {!canEdit ? (
              <Alert closeLabel="Close" title="Read only" variant="default">
                You can view this configuration but not change it.
              </Alert>
            ) : null}

            {loading || !data || !draft ? (
              <Flex justifyContent="center" padding={8}>
                <Loader>Loading</Loader>
              </Flex>
            ) : (
              <>
                <Section
                  title="Collections"
                  hint="Nothing is exposed until you switch it on here. This applies to every role, including super admins."
                >
                  <Table colCount={5} rowCount={data.candidates.length}>
                    <Thead>
                      <Tr>
                        <Th>
                          <Typography variant="sigma">Collection</Typography>
                        </Th>
                        <Th>
                          <Typography variant="sigma">Enabled</Typography>
                        </Th>
                        <Th>
                          <Typography variant="sigma">Import</Typography>
                        </Th>
                        <Th>
                          <Typography variant="sigma">Export</Typography>
                        </Th>
                        <Th>
                          <Typography variant="sigma">Match rows on</Typography>
                        </Th>
                      </Tr>
                    </Thead>
                    <Tbody>
                      {data.candidates.map((candidate: CollectionSummary) => {
                        const config = collectionOf(candidate.uid);

                        return (
                          <Tr key={candidate.uid}>
                            <Td>
                              <Flex direction="column" alignItems="flex-start">
                                <Typography fontWeight="semiBold">
                                  {candidate.displayName}
                                </Typography>
                                <Typography variant="pi" textColor="neutral600">
                                  {candidate.uid}
                                </Typography>
                              </Flex>
                            </Td>
                            <Td>
                              <Switch
                                checked={config.enabled}
                                onCheckedChange={(checked: boolean) =>
                                  patchCollection(candidate.uid, { enabled: checked })
                                }
                                disabled={!canEdit}
                                visibleLabels
                              />
                            </Td>
                            <Td>
                              <Checkbox
                                checked={config.allowImport}
                                onCheckedChange={(checked: boolean) =>
                                  patchCollection(candidate.uid, { allowImport: Boolean(checked) })
                                }
                                disabled={!canEdit || !config.enabled}
                              />
                            </Td>
                            <Td>
                              <Checkbox
                                checked={config.allowExport}
                                onCheckedChange={(checked: boolean) =>
                                  patchCollection(candidate.uid, { allowExport: Boolean(checked) })
                                }
                                disabled={!canEdit || !config.enabled}
                              />
                            </Td>
                            <Td>
                              <SingleSelect
                                value={config.identifierField}
                                onChange={(value: string | number) =>
                                  patchCollection(candidate.uid, {
                                    identifierField: String(value),
                                  })
                                }
                                disabled={!canEdit || !config.enabled}
                                size="S"
                              >
                                {candidate.lookupKeys.map((key) => (
                                  <SingleSelectOption key={key} value={key}>
                                    {key}
                                  </SingleSelectOption>
                                ))}
                              </SingleSelect>
                            </Td>
                          </Tr>
                        );
                      })}
                    </Tbody>
                  </Table>

                  {data.candidates.length === 0 ? (
                    <Box padding={4}>
                      <Typography textColor="neutral600">
                        No API collection types were found in this project.
                      </Typography>
                    </Box>
                  ) : null}
                </Section>

                <Section
                  title="Role access"
                  hint="A role needs a grant here as well as the plugin permission under Settings → Roles. Super admins are always granted."
                >
                  {enabledCollections.length === 0 ? (
                    <Box padding={4}>
                      <Typography textColor="neutral600">
                        Enable a collection above to grant access to it.
                      </Typography>
                    </Box>
                  ) : (
                    <Accordion.Root>
                      {data.roles.map((role) => (
                        <Accordion.Item key={role.id} value={String(role.id)}>
                          <Accordion.Header>
                            <Accordion.Trigger>{`${role.name} (${role.code})`}</Accordion.Trigger>
                          </Accordion.Header>
                          <Accordion.Content>
                            <Box padding={4}>
                              {role.code === 'strapi-super-admin' ? (
                                <Typography textColor="neutral600">
                                  Super admins are granted every enabled collection automatically.
                                </Typography>
                              ) : (
                                <Table colCount={3} rowCount={enabledCollections.length}>
                                  <Thead>
                                    <Tr>
                                      <Th>
                                        <Typography variant="sigma">Collection</Typography>
                                      </Th>
                                      <Th>
                                        <Typography variant="sigma">May import</Typography>
                                      </Th>
                                      <Th>
                                        <Typography variant="sigma">May export</Typography>
                                      </Th>
                                    </Tr>
                                  </Thead>
                                  <Tbody>
                                    {enabledCollections.map((candidate) => {
                                      const config = collectionOf(candidate.uid);
                                      const grant =
                                        draft.roleGrants[String(role.id)]?.[candidate.uid] ?? {
                                          import: false,
                                          export: false,
                                        };

                                      return (
                                        <Tr key={candidate.uid}>
                                          <Td>
                                            <Typography>{candidate.displayName}</Typography>
                                          </Td>
                                          <Td>
                                            <Checkbox
                                              checked={grant.import}
                                              onCheckedChange={(checked: boolean) =>
                                                patchGrant(role.id, candidate.uid, {
                                                  import: Boolean(checked),
                                                })
                                              }
                                              disabled={!canEdit || !config.allowImport}
                                            />
                                          </Td>
                                          <Td>
                                            <Checkbox
                                              checked={grant.export}
                                              onCheckedChange={(checked: boolean) =>
                                                patchGrant(role.id, candidate.uid, {
                                                  export: Boolean(checked),
                                                })
                                              }
                                              disabled={!canEdit || !config.allowExport}
                                            />
                                          </Td>
                                        </Tr>
                                      );
                                    })}
                                  </Tbody>
                                </Table>
                              )}
                            </Box>
                          </Accordion.Content>
                        </Accordion.Item>
                      ))}
                    </Accordion.Root>
                  )}
                </Section>

                <Section title="CSV format" hint="Applies to templates, exports and the guide file.">
                  <Box padding={4}>
                    <Flex direction="column" alignItems="stretch" gap={4}>
                      <Field.Root
                        name="csvDelimiter"
                        hint="Imports detect the delimiter automatically, so this only affects files the plugin writes."
                      >
                        <Field.Label>Column delimiter</Field.Label>
                        <SingleSelect
                          value={draft.csvDelimiter}
                          onChange={(value: string | number) =>
                            setDraft({ ...draft, csvDelimiter: String(value) })
                          }
                          disabled={!canEdit}
                        >
                          {data.options.delimiters.map((delimiter) => (
                            <SingleSelectOption key={delimiter} value={delimiter}>
                              {DELIMITER_LABELS[delimiter] ?? delimiter}
                            </SingleSelectOption>
                          ))}
                        </SingleSelect>
                        <Field.Hint />
                      </Field.Root>

                      <Field.Root
                        name="multiValueDelimiter"
                        hint="Separates several references inside one cell. Must differ from the column delimiter."
                      >
                        <Field.Label>List separator inside a cell</Field.Label>
                        <SingleSelect
                          value={draft.multiValueDelimiter}
                          onChange={(value: string | number) =>
                            setDraft({ ...draft, multiValueDelimiter: String(value) })
                          }
                          disabled={!canEdit}
                        >
                          {[';', '|', ',', '#'].map((delimiter) => (
                            <SingleSelectOption
                              key={delimiter}
                              value={delimiter}
                              disabled={delimiter === draft.csvDelimiter}
                            >
                              {delimiter}
                            </SingleSelectOption>
                          ))}
                        </SingleSelect>
                        <Field.Hint />
                      </Field.Root>

                      <Field.Root name="mediaLookupKey" hint="How a cell names a Media Library file.">
                        <Field.Label>Match media files on</Field.Label>
                        <SingleSelect
                          value={draft.mediaLookupKey}
                          onChange={(value: string | number) =>
                            setDraft({ ...draft, mediaLookupKey: String(value) })
                          }
                          disabled={!canEdit}
                        >
                          {data.options.mediaLookupKeys.map((key) => (
                            <SingleSelectOption key={key} value={key}>
                              {key}
                            </SingleSelectOption>
                          ))}
                        </SingleSelect>
                        <Field.Hint />
                      </Field.Root>

                      <Field.Root name="defaultImportMode">
                        <Field.Label>Default import mode</Field.Label>
                        <SingleSelect
                          value={draft.defaultImportMode}
                          onChange={(value: string | number) =>
                            setDraft({ ...draft, defaultImportMode: String(value) as ImportMode })
                          }
                          disabled={!canEdit}
                        >
                          {data.options.importModes.map((mode) => (
                            <SingleSelectOption key={mode} value={mode}>
                              {MODE_LABELS[mode] ?? mode}
                            </SingleSelectOption>
                          ))}
                        </SingleSelect>
                      </Field.Root>

                      <Divider />

                      <Flex gap={6} wrap="wrap">
                        <Flex direction="column" alignItems="flex-start" gap={1}>
                          <Typography variant="pi" fontWeight="bold">
                            Add a UTF-8 BOM
                          </Typography>
                          <Switch
                            checked={draft.includeBom}
                            onCheckedChange={(checked: boolean) =>
                              setDraft({ ...draft, includeBom: checked })
                            }
                            disabled={!canEdit}
                            visibleLabels
                          />
                          <Typography variant="pi" textColor="neutral600">
                            Needed for Excel on Windows to read accented characters correctly.
                          </Typography>
                        </Flex>

                        <Flex direction="column" alignItems="flex-start" gap={1}>
                          <Typography variant="pi" fontWeight="bold">
                            Neutralise spreadsheet formulas
                          </Typography>
                          <Switch
                            checked={draft.escapeFormulas}
                            onCheckedChange={(checked: boolean) =>
                              setDraft({ ...draft, escapeFormulas: checked })
                            }
                            disabled={!canEdit}
                            visibleLabels
                          />
                          <Typography variant="pi" textColor="neutral600">
                            Keep this on. It stops exported content from running as a formula when
                            the file is opened.
                          </Typography>
                        </Flex>
                      </Flex>
                    </Flex>
                  </Box>
                </Section>

                <Section title="Limits" hint="Guard rails for uploads and background work.">
                  <Box padding={4}>
                    <Flex gap={4} wrap="wrap">
                      <NumberField
                        label="Largest upload (MB)"
                        value={draft.maxFileSizeMb}
                        bound={data.limits.maxFileSizeMb}
                        disabled={!canEdit}
                        onChange={(value) => setDraft({ ...draft, maxFileSizeMb: value })}
                      />
                      <NumberField
                        label="Most rows per file"
                        value={draft.maxRows}
                        bound={data.limits.maxRows}
                        disabled={!canEdit}
                        onChange={(value) => setDraft({ ...draft, maxRows: value })}
                      />
                      <NumberField
                        label="Rows per transaction"
                        value={draft.batchSize}
                        bound={data.limits.batchSize}
                        disabled={!canEdit}
                        onChange={(value) => setDraft({ ...draft, batchSize: value })}
                      />
                      <NumberField
                        label="Template slots per repeatable component"
                        value={draft.templateRepeatableSlots}
                        bound={data.limits.templateRepeatableSlots}
                        disabled={!canEdit}
                        onChange={(value) =>
                          setDraft({ ...draft, templateRepeatableSlots: value })
                        }
                      />
                      <NumberField
                        label="Keep history for (days)"
                        value={draft.jobRetentionDays}
                        bound={data.limits.jobRetentionDays}
                        disabled={!canEdit}
                        onChange={(value) => setDraft({ ...draft, jobRetentionDays: value })}
                      />
                    </Flex>
                  </Box>
                </Section>
              </>
            )}
          </Flex>
        </Layouts.Content>
      </Main>
    </Page.Protect>
  );
};

function Section({
  title,
  hint,
  children,
}: {
  title: string;
  hint: string;
  children: React.ReactNode;
}) {
  return (
    <Box background="neutral0" hasRadius shadow="tableShadow" padding={0}>
      <Box padding={4} paddingBottom={2}>
        <Typography variant="delta" tag="h2">
          {title}
        </Typography>
        <Box paddingTop={1}>
          <Typography variant="pi" textColor="neutral600">
            {hint}
          </Typography>
        </Box>
      </Box>
      {children}
    </Box>
  );
}

function NumberField({
  label,
  value,
  bound,
  disabled,
  onChange,
}: {
  label: string;
  value: number;
  bound?: { min: number; max: number };
  disabled: boolean;
  onChange: (value: number) => void;
}) {
  return (
    <Box minWidth="16rem">
      <Field.Root name={label} hint={bound ? `${bound.min} to ${bound.max}` : undefined}>
        <Field.Label>{label}</Field.Label>
        <Field.Input
          type="number"
          value={String(value)}
          min={bound?.min}
          max={bound?.max}
          disabled={disabled}
          onChange={(event: React.ChangeEvent<HTMLInputElement>) => {
            const next = Number(event.target.value);
            if (!Number.isNaN(next)) onChange(next);
          }}
        />
        <Field.Hint />
      </Field.Root>
    </Box>
  );
}

export { SettingsPage };
