import {
  Alert,
  Badge,
  Box,
  Button,
  Divider,
  Flex,
  Table,
  Tbody,
  Td,
  Th,
  Thead,
  Tr,
  Typography,
} from '@strapi/design-system';
import { Download } from '@strapi/icons';
import type { JobRecord } from '../utils/api';
import { endpointPaths, suggestFileName, useCsvDownload } from '../utils/download';

const MAX_VISIBLE_ERRORS = 50;

interface JobReportProps {
  job: JobRecord;
  onDownloadError?: (message: string) => void;
}

function Counter({ label, value, tone }: { label: string; value: number; tone?: string }) {
  return (
    <Flex direction="column" alignItems="flex-start" gap={1}>
      <Typography variant="beta" textColor={tone}>
        {value}
      </Typography>
      <Typography variant="pi" textColor="neutral600">
        {label}
      </Typography>
    </Flex>
  );
}

export const JobReport = ({ job, onDownloadError }: JobReportProps) => {
  const csv = useCsvDownload();
  const header = job.report?.header;
  const aborted = job.report?.aborted ?? null;
  const errors = job.rowErrors ?? [];
  const visibleErrors = errors.slice(0, MAX_VISIBLE_ERRORS);

  const isRunning = job.jobStatus === 'running' || job.jobStatus === 'queued';
  const total = job.totalRows ?? 0;
  const processed = job.processedRows ?? 0;

  const handleDownloadErrors = async () => {
    try {
      await csv.download(
        endpointPaths.jobErrors(job.documentId),
        suggestFileName(job.contentTypeUid, 'import-errors')
      );
    } catch (error) {
      onDownloadError?.(error instanceof Error ? error.message : 'Could not download the report.');
    }
  };

  return (
    <Flex direction="column" alignItems="stretch" gap={4}>
      {aborted ? (
        <Alert closeLabel="Close" title="The file was rejected" variant="danger">
          {aborted.message}
        </Alert>
      ) : null}

      {!aborted && job.failureMessage ? (
        <Alert closeLabel="Close" title="The run did not finish" variant="danger">
          {job.failureMessage}
        </Alert>
      ) : null}

      {isRunning ? (
        <Alert closeLabel="Close" title="Working" variant="default">
          {total > 0
            ? `Processed ${processed} of ${total} rows so far.`
            : `Reading the file. ${processed} rows processed so far.`}
        </Alert>
      ) : null}

      {job.jobKind === 'dry-run' && job.jobStatus === 'completed' && !aborted ? (
        <Alert closeLabel="Close" title="Nothing was written" variant="success">
          This was a validation run. Review the numbers below, then run the import to apply them.
        </Alert>
      ) : null}

      <Flex gap={8} wrap="wrap">
        <Counter label="rows in file" value={total} />
        <Counter
          label={job.jobKind === 'dry-run' ? 'would create' : 'created'}
          value={job.createdCount ?? 0}
          tone="success600"
        />
        <Counter
          label={job.jobKind === 'dry-run' ? 'would update' : 'updated'}
          value={job.updatedCount ?? 0}
          tone="primary600"
        />
        <Counter label="skipped" value={job.skippedCount ?? 0} tone="neutral600" />
        <Counter label="failed" value={job.failedCount ?? 0} tone="danger600" />
      </Flex>

      {header ? (
        <>
          <Divider />
          <Flex direction="column" alignItems="stretch" gap={2}>
            <Typography variant="delta">Columns</Typography>

            <Flex gap={2} wrap="wrap">
              <Badge>{`${header.recognised.length} matched`}</Badge>
              {header.unknownColumns.length > 0 ? (
                <Badge textColor="danger700" backgroundColor="danger100">
                  {`${header.unknownColumns.length} not recognised`}
                </Badge>
              ) : null}
              {header.readOnlyIgnored.length > 0 ? (
                <Badge textColor="neutral700" backgroundColor="neutral150">
                  {`${header.readOnlyIgnored.length} read-only, ignored`}
                </Badge>
              ) : null}
              {header.identifierColumn ? (
                <Badge textColor="primary700" backgroundColor="primary100">
                  {`matching on ${header.identifierColumn}`}
                </Badge>
              ) : null}
            </Flex>

            {header.unknownColumns.length > 0 ? (
              <Box paddingTop={2}>
                {header.unknownColumns.map((column) => (
                  <Typography key={column.header} variant="pi" textColor="neutral700" tag="p">
                    <strong>{column.header}</strong>
                    {` — ${column.reason}`}
                    {column.suggestion ? ` Did you mean "${column.suggestion}"?` : ''}
                  </Typography>
                ))}
              </Box>
            ) : null}

            {!header.identifierColumn ? (
              <Typography variant="pi" textColor="neutral600">
                No identifier column was found, so every row is treated as a new entry. Include the
                documentId column to update existing ones.
              </Typography>
            ) : null}
          </Flex>
        </>
      ) : null}

      {errors.length > 0 ? (
        <>
          <Divider />
          <Flex justifyContent="space-between" alignItems="center">
            <Typography variant="delta">{`Row problems (${errors.length}${
              job.errorsTruncated ? '+' : ''
            })`}</Typography>
            <Button variant="tertiary" startIcon={<Download />} onClick={handleDownloadErrors}>
              Download as CSV
            </Button>
          </Flex>

          <Box overflow="auto" maxHeight="32rem">
            <Table colCount={3} rowCount={visibleErrors.length}>
              <Thead>
                <Tr>
                  <Th>
                    <Typography variant="sigma">Line</Typography>
                  </Th>
                  <Th>
                    <Typography variant="sigma">Column</Typography>
                  </Th>
                  <Th>
                    <Typography variant="sigma">Problem</Typography>
                  </Th>
                </Tr>
              </Thead>
              <Tbody>
                {visibleErrors.map((error, index) => (
                  <Tr key={`${error.line}-${error.column ?? ''}-${error.code}-${index}`}>
                    <Td>
                      <Typography>{error.line}</Typography>
                    </Td>
                    <Td>
                      <Typography textColor="neutral700">{error.column ?? '—'}</Typography>
                    </Td>
                    <Td>
                      <Typography>{error.message}</Typography>
                    </Td>
                  </Tr>
                ))}
              </Tbody>
            </Table>
          </Box>

          {errors.length > visibleErrors.length ? (
            <Typography variant="pi" textColor="neutral600">
              {`Showing the first ${visibleErrors.length}. Download the CSV for the rest.`}
            </Typography>
          ) : null}
        </>
      ) : null}
    </Flex>
  );
};
