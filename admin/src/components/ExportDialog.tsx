import { useState } from 'react';
import {
  Alert,
  Button,
  Field,
  Flex,
  Modal,
  SingleSelect,
  SingleSelectOption,
  Typography,
} from '@strapi/design-system';
import { Download } from '@strapi/icons';
import { endpointPaths, exportFileName, useCsvDownload } from '../utils/download';

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
  const [status, setStatus] = useState<'draft' | 'published'>('draft');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectionCount = selectedDocumentIds?.length ?? 0;

  const download = async () => {
    setBusy(true);
    setError(null);

    try {
      await csv.downloadWithBody(
        endpointPaths.export(uid),
        {
          status: hasDraftAndPublish ? status : undefined,
          documentIds: selectionCount > 0 ? selectedDocumentIds : undefined,
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
                : 'Exporting every entry you are allowed to read.'}
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
          <Button startIcon={<Download />} onClick={download} loading={busy}>
            Download CSV
          </Button>
        </Modal.Footer>
      </Modal.Content>
    </Modal.Root>
  );
};
