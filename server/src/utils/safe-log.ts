import { PLUGIN_NAME } from '../constants';

const MAX_ECHOED_VALUE = 80;

/**
 * Shortens a value echoed back to the operator in a validation message. Error text has to name
 * the offending value to be useful, but a whole cell could be a long block of personal data.
 */
export function truncateForMessage(value: string): string {
  if (value.length <= MAX_ECHOED_VALUE) return value;

  return `${value.slice(0, MAX_ECHOED_VALUE)}…`;
}

/**
 * Builds a log line that carries no cell contents.
 *
 * Validation messages stay in the job record, which only an authorised administrator can read.
 * The application log is a different audience with a different retention policy, so it gets
 * counts, row numbers and column names and nothing that came out of the file.
 */
export function jobLogLine(
  event: string,
  details: Record<string, string | number | boolean | undefined>
): string {
  const parts = Object.entries(details)
    .filter(([, value]) => value !== undefined)
    .map(([key, value]) => `${key}=${value}`);

  return `[${PLUGIN_NAME}] ${event}${parts.length > 0 ? ` ${parts.join(' ')}` : ''}`;
}
