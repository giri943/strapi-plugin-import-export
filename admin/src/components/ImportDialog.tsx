import { useEffect, useRef, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Field,
  Flex,
  Loader,
  Modal,
  SingleSelect,
  SingleSelectOption,
  Typography,
} from '@strapi/design-system';
import { Download, Upload } from '@strapi/icons';
import {
  fetchColumns,
  fetchJob,
  startImport,
  type ColumnsResponse,
  type ImportMode,
  type JobRecord,
} from '../utils/api';
import { endpointPaths, suggestFileName, useCsvDownload } from '../utils/download';
import { JobReport } from './JobReport';

const POLL_INTERVAL_MS = 1_000;

const MODE_LABELS: Record<ImportMode, string> = {
  upsert: 'Update matching entries, create the rest',
  'create-only': 'Only create — fail rows that already exist',
  'update-only': 'Only update — fail rows that do not exist',
  'skip-duplicates': 'Create new entries, silently skip existing ones',
};

interface ImportDialogProps {
  uid: string;
  displayName: string;
  canDownloadTemplate: boolean;
  onClose: () => void;
  onFinished?: () => void;
}

type Phase = 'choose' | 'validating' | 'validated' | 'importing' | 'done';

export const ImportDialog = ({
  uid,
  displayName,
  canDownloadTemplate,
  onClose,
  onFinished,
}: ImportDialogProps) => {
  const csv = useCsvDownload();
  const [meta, setMeta] = useState<ColumnsResponse | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [mode, setMode] = useState<ImportMode>('upsert');
  const [phase, setPhase] = useState<Phase>('choose');
  const [job, setJob] = useState<JobRecord | null>(null);
  const [error, setError] = useState<string | null>(null);

  const pollRef = useRef<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const stopPolling = () => {
    if (pollRef.current !== null) {
      window.clearInterval(pollRef.current);
      pollRef.current = null;
    }
  };

  useEffect(() => stopPolling, []);

  useEffect(() => {
    let active = true;

    fetchColumns(uid)
      .then((response) => {
        if (!active) return;
        setMeta(response);
        setMode(response.defaultImportMode);
      })
      .catch((cause: unknown) => {
        if (active) setError(cause instanceof Error ? cause.message : 'Could not read the schema.');
      });

    return () => {
      active = false;
    };
  }, [uid]);

  /**
   * Imports run in the background, so the dialog follows the job record rather than waiting on
   * the request. A 200,000-row file would otherwise outlive the response.
   */
  const followJob = (jobId: string, finalPhase: Phase) => {
    stopPolling();

    pollRef.current = window.setInterval(async () => {
      try {
        const latest = await fetchJob(jobId);
        setJob(latest);

        if (latest.jobStatus !== 'running' && latest.jobStatus !== 'queued') {
          stopPolling();
          setPhase(finalPhase);
          if (finalPhase === 'done') onFinished?.();
        }
      } catch (cause) {
        stopPolling();
        setError(cause instanceof Error ? cause.message : 'Lost track of the import.');
        setPhase('choose');
      }
    }, POLL_INTERVAL_MS);
  };

  const run = async (dryRun: boolean) => {
    if (!file) return;

    setError(null);
    setJob(null);
    setPhase(dryRun ? 'validating' : 'importing');

    try {
      const started = await startImport(uid, file, { mode, dryRun });
      followJob(started.jobId, dryRun ? 'validated' : 'done');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The upload was rejected.');
      setPhase('choose');
    }
  };

  const downloadTemplate = async (guide: boolean) => {
    setError(null);

    try {
      await csv.download(
        guide ? endpointPaths.guide(uid) : endpointPaths.template(uid),
        suggestFileName(uid, guide ? 'guide' : 'template')
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not download the template.');
    }
  };

  const busy = phase === 'validating' || phase === 'importing';
  const validationFailed = Boolean(job?.report?.aborted) || (job?.failedCount ?? 0) > 0;
  const nothingToApply =
    phase === 'validated' && (job?.createdCount ?? 0) + (job?.updatedCount ?? 0) === 0;

  return (
    <Modal.Root open onOpenChange={(open: boolean) => (!open && !busy ? onClose() : undefined)}>
      <Modal.Content>
        <Modal.Header>
          <Modal.Title>{`Import CSV into ${displayName}`}</Modal.Title>
        </Modal.Header>

        <Modal.Body>
          <Flex direction="column" alignItems="stretch" gap={5}>
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

            {!meta && !error ? (
              <Flex justifyContent="center" padding={6}>
                <Loader small>Reading the schema</Loader>
              </Flex>
            ) : null}

            {meta ? (
              <>
                {canDownloadTemplate ? (
                  <Flex gap={2} wrap="wrap">
                    <Button
                      variant="secondary"
                      startIcon={<Download />}
                      onClick={() => downloadTemplate(false)}
                      disabled={busy}
                    >
                      Download template
                    </Button>
                    <Button
                      variant="tertiary"
                      onClick={() => downloadTemplate(true)}
                      disabled={busy}
                    >
                      Download column guide
                    </Button>
                  </Flex>
                ) : null}

                <Field.Root name="file" hint={`Up to ${meta.limits.maxFileSizeMb} MB and ${meta.limits.maxRows.toLocaleString()} rows. Save as "CSV UTF-8".`}>
                  <Field.Label>CSV file</Field.Label>
                  <Box
                    padding={3}
                    background="neutral100"
                    hasRadius
                    borderColor="neutral200"
                    borderStyle="dashed"
                    borderWidth="1px"
                  >
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept=".csv,.tsv,.txt,text/csv"
                      disabled={busy}
                      onChange={(event) => {
                        setFile(event.target.files?.[0] ?? null);
                        setJob(null);
                        setPhase('choose');
                      }}
                    />
                  </Box>
                  <Field.Hint />
                </Field.Root>

                <Field.Root name="mode">
                  <Field.Label>What should happen to rows that already exist?</Field.Label>
                  <SingleSelect
                    value={mode}
                    onChange={(value: string | number) => setMode(String(value) as ImportMode)}
                    disabled={busy}
                  >
                    {(Object.keys(MODE_LABELS) as ImportMode[]).map((option) => (
                      <SingleSelectOption key={option} value={option}>
                        {MODE_LABELS[option]}
                      </SingleSelectOption>
                    ))}
                  </SingleSelect>
                  <Field.Hint />
                </Field.Root>

                <Typography variant="pi" textColor="neutral600">
                  {`Rows are matched on "${meta.identifierField}". A column that is present but empty clears that field; a column left out of the file is never touched.`}
                </Typography>

                {busy ? (
                  <Flex gap={3} alignItems="center">
                    <Loader small />
                    <Typography>
                      {phase === 'validating' ? 'Checking the file' : 'Importing'}
                    </Typography>
                  </Flex>
                ) : null}

                {job ? <JobReport job={job} onDownloadError={setError} /> : null}
              </>
            ) : null}
          </Flex>
        </Modal.Body>

        <Modal.Footer>
          <Button variant="tertiary" onClick={onClose} disabled={busy}>
            {phase === 'done' ? 'Close' : 'Cancel'}
          </Button>

          {phase === 'done' ? null : (
            <Flex gap={2}>
              <Button
                variant="secondary"
                onClick={() => run(true)}
                disabled={!file || busy}
                loading={phase === 'validating'}
              >
                Check the file
              </Button>
              <Button
                startIcon={<Upload />}
                onClick={() => run(false)}
                // Importing is only offered after a clean validation run. It stops a file with a
                // broken header from being applied by someone clicking straight through.
                disabled={
                  !file || busy || phase !== 'validated' || validationFailed || nothingToApply
                }
                loading={phase === 'importing'}
              >
                {nothingToApply && phase === 'validated' ? 'Nothing to import' : 'Import'}
              </Button>
            </Flex>
          )}
        </Modal.Footer>
      </Modal.Content>
    </Modal.Root>
  );
};
