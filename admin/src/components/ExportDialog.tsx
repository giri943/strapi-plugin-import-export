import { useEffect, useState } from 'react';
import {
  Alert,
  Button,
  Divider,
  Field,
  Flex,
  Loader,
  Modal,
  SingleSelect,
  SingleSelectOption,
  Typography,
} from '@strapi/design-system';
import { Download } from '@strapi/icons';
import { fetchColumns, type ColumnsResponse } from '../utils/api';
import { endpointPaths, exportFileName, useCsvDownload } from '../utils/download';
import { loadColumnSelection, saveColumnSelection } from '../utils/column-preferences';
import { ColumnPicker } from './ColumnPicker';
import {
  ExportFilters,
  toDatePayload,
  toRelationPayload,
  type DateFilterDraft,
  type RelationFilterDraft,
} from './ExportFilters';

interface ExportDialogProps {
  uid: string;
  displayName: string;
  hasDraftAndPublish: boolean;
  /** Set when the user triggered the export from a row selection in the List View. */
  selectedDocumentIds?: string[];
  onClose: () => void;
}

export const ExportDialog = ({
  uid,
  displayName,
  hasDraftAndPublish,
  selectedDocumentIds,
  onClose,
}: ExportDialogProps) => {
  const csv = useCsvDownload();

  const [meta, setMeta] = useState<ColumnsResponse | null>(null);
  const [status, setStatus] = useState<'draft' | 'published'>('draft');
  const [columns, setColumns] = useState<string[]>([]);
  const [relationFilters, setRelationFilters] = useState<RelationFilterDraft[]>([]);
  const [dateFilters, setDateFilters] = useState<DateFilterDraft[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectionCount = selectedDocumentIds?.length ?? 0;

  useEffect(() => {
    let active = true;

    fetchColumns(uid)
      .then((response) => {
        if (!active) return;
        setMeta(response);
        setColumns(loadColumnSelection(uid) ?? []);
      })
      .catch((cause: unknown) => {
        if (active) setError(cause instanceof Error ? cause.message : 'Could not read the schema.');
      });

    return () => {
      active = false;
    };
  }, [uid]);

  const download = async () => {
    setBusy(true);
    setError(null);

    try {
      saveColumnSelection(uid, columns);

      await csv.downloadWithBody(
        endpointPaths.export(uid),
        {
          status: hasDraftAndPublish ? status : undefined,
          documentIds: selectionCount > 0 ? selectedDocumentIds : undefined,
          columns: columns.length > 0 ? columns : undefined,
          relationFilters: toRelationPayload(relationFilters),
          dateFilters: toDatePayload(dateFilters),
        },
        exportFileName(uid)
      );
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The export failed.');
    } finally {
      setBusy(false);
    }
  };

  // A row selection already says which entries to take, so filters would only contradict it.
  const filtersApply = selectionCount === 0;

  return (
    <Modal.Root open onOpenChange={(open: boolean) => (!open && !busy ? onClose() : undefined)}>
      <Modal.Content>
        <Modal.Header>
          <Modal.Title>{`Export ${displayName} to CSV`}</Modal.Title>
        </Modal.Header>

        <Modal.Body>
          <Flex direction="column" alignItems="stretch" gap={5}>
            {error ? (
              <Alert
                closeLabel="Close"
                onClose={() => setError(null)}
                title="The export failed"
                variant="danger"
              >
                {error}
              </Alert>
            ) : null}

            <Typography>
              {selectionCount > 0
                ? `Exporting the ${selectionCount} selected ${
                    selectionCount === 1 ? 'entry' : 'entries'
                  }.`
                : 'Exporting every entry you are allowed to read, narrowed by the filters below.'}
            </Typography>

            {hasDraftAndPublish ? (
              <Field.Root
                name="status"
                hint="A CSV holds one version of each entry. The status column in the file states which one."
              >
                <Field.Label>Which version?</Field.Label>
                <SingleSelect
                  value={status}
                  onChange={(value: string | number) =>
                    setStatus(String(value) === 'published' ? 'published' : 'draft')
                  }
                  disabled={busy}
                >
                  <SingleSelectOption value="draft">
                    Draft — the working copy shown in the editor
                  </SingleSelectOption>
                  <SingleSelectOption value="published">
                    Published — what the public API returns
                  </SingleSelectOption>
                </SingleSelect>
                <Field.Hint />
              </Field.Root>
            ) : null}

            {!meta ? (
              <Flex justifyContent="center" padding={4}>
                <Loader small>Reading the schema</Loader>
              </Flex>
            ) : (
              <>
                {filtersApply ? (
                  <>
                    <Divider />
                    <ExportFilters
                      uid={uid}
                      filterableRelations={meta.filterableRelations}
                      filterableDates={meta.filterableDates}
                      relationFilters={relationFilters}
                      dateFilters={dateFilters}
                      onRelationFiltersChange={setRelationFilters}
                      onDateFiltersChange={setDateFilters}
                      disabled={busy}
                      onError={setError}
                    />
                  </>
                ) : null}

                <Divider />
                <ColumnPicker
                  columns={meta.columns}
                  selected={columns}
                  onChange={setColumns}
                  identifierHeader={meta.identifierHeader}
                  disabled={busy}
                />
              </>
            )}

            <Typography variant="pi" textColor="neutral600">
              Fields your role cannot read are left out of the file, and password fields are never
              included.
            </Typography>
          </Flex>
        </Modal.Body>

        <Modal.Footer>
          <Button variant="tertiary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button startIcon={<Download />} onClick={download} loading={busy} disabled={!meta}>
            Download CSV
          </Button>
        </Modal.Footer>
      </Modal.Content>
    </Modal.Root>
  );
};
