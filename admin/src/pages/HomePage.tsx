import { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  Badge,
  Box,
  Button,
  EmptyStateLayout,
  Flex,
  Loader,
  Main,
  Modal,
  Table,
  Tbody,
  Td,
  Th,
  Thead,
  Tr,
  Typography,
} from '@strapi/design-system';
import { ArrowClockwise } from '@strapi/icons';
import { Layouts, Page, useRBAC } from '@strapi/strapi/admin';
import pluginPermissions, { RBAC_FLAGS, type AllowedActions } from '../permissions';
import { fetchJobs, type JobRecord } from '../utils/api';
import { JobReport } from '../components/JobReport';

const STATUS_TONES: Record<JobRecord['jobStatus'], { bg: string; fg: string }> = {
  queued: { bg: 'neutral150', fg: 'neutral700' },
  running: { bg: 'primary100', fg: 'primary700' },
  completed: { bg: 'success100', fg: 'success700' },
  failed: { bg: 'danger100', fg: 'danger700' },
  interrupted: { bg: 'warning100', fg: 'warning700' },
};

function formatWhen(value: string | undefined): string {
  if (!value) return '—';

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString();
}

const HomePage = () => {
  const { isLoading: rbacLoading, allowedActions } = useRBAC(pluginPermissions.readHistory);
  const allowed = allowedActions as AllowedActions;
  const [jobs, setJobs] = useState<JobRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<JobRecord | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const response = await fetchJobs({ page: 1, pageSize: 50 });
      setJobs(response.results);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not load the history.');
    } finally {
      setLoading(false);
    }
  }, []);

  const canReadHistory = Boolean(allowed[RBAC_FLAGS.readHistory]);

  useEffect(() => {
    if (rbacLoading) return;

    if (canReadHistory) {
      void load();
      return;
    }

    // Clearing the flag here matters: `loading` starts true, so a permission the panel cannot
    // see would otherwise leave the page spinning forever with no error to explain it.
    setLoading(false);
  }, [rbacLoading, canReadHistory, load]);

  if (rbacLoading) return <Page.Loading />;

  return (
    <Page.Protect permissions={pluginPermissions.readHistory}>
      <Main>
        <Layouts.Header
          title="CSV Import & Export"
          subtitle="Every validation run and import, with its result."
          primaryAction={
            <Button
              variant="secondary"
              startIcon={<ArrowClockwise />}
              onClick={load}
              loading={loading}
            >
              Refresh
            </Button>
          }
        />

        <Layouts.Content>
          <Flex direction="column" alignItems="stretch" gap={4}>
            {error ? (
              <Alert
                closeLabel="Close"
                onClose={() => setError(null)}
                title="Could not load the history"
                variant="danger"
              >
                {error}
              </Alert>
            ) : null}

            {loading && jobs.length === 0 ? (
              <Flex justifyContent="center" padding={8}>
                <Loader>Loading</Loader>
              </Flex>
            ) : null}

            {!loading && jobs.length === 0 && !error ? (
              <Box background="neutral0" hasRadius shadow="tableShadow" padding={8}>
                <EmptyStateLayout
                  content="No imports have run yet. Open a collection in the Content Manager and use the CSV menu."
                  icon={null}
                />
              </Box>
            ) : null}

            {jobs.length > 0 ? (
              <Box background="neutral0" hasRadius shadow="tableShadow">
                <Table colCount={7} rowCount={jobs.length}>
                  <Thead>
                    <Tr>
                      <Th>
                        <Typography variant="sigma">Collection</Typography>
                      </Th>
                      <Th>
                        <Typography variant="sigma">Kind</Typography>
                      </Th>
                      <Th>
                        <Typography variant="sigma">Status</Typography>
                      </Th>
                      <Th>
                        <Typography variant="sigma">Result</Typography>
                      </Th>
                      <Th>
                        <Typography variant="sigma">File</Typography>
                      </Th>
                      <Th>
                        <Typography variant="sigma">Started</Typography>
                      </Th>
                      <Th>
                        <Typography variant="sigma">By</Typography>
                      </Th>
                    </Tr>
                  </Thead>
                  <Tbody>
                    {jobs.map((job) => {
                      const tone = STATUS_TONES[job.jobStatus];

                      return (
                        <Tr
                          key={job.documentId}
                          onClick={() => setSelected(job)}
                          style={{ cursor: 'pointer' }}
                        >
                          <Td>
                            <Typography>{job.contentTypeUid}</Typography>
                          </Td>
                          <Td>
                            <Typography textColor="neutral700">
                              {job.jobKind === 'dry-run' ? 'check only' : job.importMode}
                            </Typography>
                          </Td>
                          <Td>
                            <Badge backgroundColor={tone.bg} textColor={tone.fg}>
                              {job.jobStatus}
                            </Badge>
                          </Td>
                          <Td>
                            <Typography textColor="neutral700">
                              {`${job.createdCount ?? 0} new, ${job.updatedCount ?? 0} updated, ${
                                job.failedCount ?? 0
                              } failed`}
                            </Typography>
                          </Td>
                          <Td>
                            <Typography textColor="neutral700">{job.fileName ?? '—'}</Typography>
                          </Td>
                          <Td>
                            <Typography textColor="neutral700">
                              {formatWhen(job.startedAt ?? job.createdAt)}
                            </Typography>
                          </Td>
                          <Td>
                            <Typography textColor="neutral700">
                              {job.requestedByEmail ?? '—'}
                            </Typography>
                          </Td>
                        </Tr>
                      );
                    })}
                  </Tbody>
                </Table>
              </Box>
            ) : null}
          </Flex>
        </Layouts.Content>

        {selected ? (
          <Modal.Root open onOpenChange={(open: boolean) => (open ? undefined : setSelected(null))}>
            <Modal.Content>
              <Modal.Header>
                <Modal.Title>{`${selected.contentTypeUid} — ${
                  selected.jobKind === 'dry-run' ? 'validation run' : 'import'
                }`}</Modal.Title>
              </Modal.Header>
              <Modal.Body>
                <JobReport job={selected} onDownloadError={setError} />
              </Modal.Body>
              <Modal.Footer>
                <Button variant="tertiary" onClick={() => setSelected(null)}>
                  Close
                </Button>
              </Modal.Footer>
            </Modal.Content>
          </Modal.Root>
        ) : null}
      </Main>
    </Page.Protect>
  );
};

export { HomePage };
