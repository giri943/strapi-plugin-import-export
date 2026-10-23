import { useEffect, useState } from 'react';
import { MenuItem, SimpleMenu } from '@strapi/design-system';
import { useRBAC, unstable_useContentManagerContext as useContentManagerContext } from '@strapi/strapi/admin';
import { FileCsv } from '@strapi/icons';
import pluginPermissions, { RBAC_FLAGS, type AllowedActions } from '../permissions';
import { fetchColumns } from '../utils/api';
import { ExportDialog } from './ExportDialog';
import { ImportDialog } from './ImportDialog';

type OpenDialog = 'none' | 'import' | 'export';

/**
 * Rendered into the Content Manager's `listView.actions` zone, which passes no props, so the
 * current collection is read from the Content Manager's own context.
 *
 * Everything here is presentation. The server re-checks the plugin action, the collection
 * allow-list, the role grant and the user's Content Manager rights on every request.
 */
export const ListViewActions = () => {
  const context = useContentManagerContext();
  const { model, isSingleType, hasDraftAndPublish, contentType } = context ?? {};

  const { isLoading: rbacLoading, allowedActions } = useRBAC([
    ...pluginPermissions.runImport,
    ...pluginPermissions.runExport,
    ...pluginPermissions.downloadTemplate,
  ]);
  const allowed = allowedActions as AllowedActions;

  const [enabled, setEnabled] = useState<{ import: boolean; export: boolean } | null>(null);
  const [dialog, setDialog] = useState<OpenDialog>('none');

  const canImport = Boolean(allowed[RBAC_FLAGS.runImport]);
  const canExport = Boolean(allowed[RBAC_FLAGS.runExport]);
  const canTemplate = Boolean(allowed[RBAC_FLAGS.downloadTemplate]);
  const mayAsk = !rbacLoading && (canImport || canExport || canTemplate);

  useEffect(() => {
    if (!model || isSingleType || !mayAsk) {
      setEnabled(null);
      return;
    }

    let active = true;

    fetchColumns(model)
      .then((response) => {
        if (active) setEnabled({ import: response.allowImport, export: response.allowExport });
      })
      .catch(() => {
        // A rejection here means this collection is not enabled for the current user, which is
        // the normal case for most collections. Rendering nothing is the right answer.
        if (active) setEnabled({ import: false, export: false });
      });

    return () => {
      active = false;
    };
  }, [model, isSingleType, mayAsk]);

  if (!model || isSingleType || !mayAsk || !enabled) return null;

  const showImport = canImport && enabled.import;
  const showTemplate = canTemplate && enabled.import;
  const showExport = canExport && enabled.export;

  if (!showImport && !showTemplate && !showExport) return null;

  const displayName = contentType?.info?.displayName ?? model;

  return (
    <>
      <SimpleMenu variant="tertiary" startIcon={<FileCsv />} label="CSV">
        {showImport || showTemplate ? (
          <MenuItem onSelect={() => setDialog('import')}>
            {showImport ? 'Import from CSV' : 'Download CSV template'}
          </MenuItem>
        ) : null}
        {showExport ? (
          <MenuItem onSelect={() => setDialog('export')}>Export to CSV</MenuItem>
        ) : null}
      </SimpleMenu>

      {dialog === 'import' ? (
        <ImportDialog
          uid={model}
          displayName={displayName}
          canDownloadTemplate={showTemplate}
          onClose={() => setDialog('none')}
        />
      ) : null}

      {dialog === 'export' ? (
        <ExportDialog
          uid={model}
          displayName={displayName}
          hasDraftAndPublish={Boolean(hasDraftAndPublish)}
          onClose={() => setDialog('none')}
        />
      ) : null}
    </>
  );
};
