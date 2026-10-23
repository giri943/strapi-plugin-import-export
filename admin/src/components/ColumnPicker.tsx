import { useMemo, useState } from 'react';
import {
  Badge,
  Box,
  Button,
  Checkbox,
  Flex,
  Searchbar,
  Typography,
} from '@strapi/design-system';
import type { ColumnDescriptor } from '../utils/api';

interface ColumnPickerProps {
  columns: ColumnDescriptor[];
  selected: string[];
  onChange: (headers: string[]) => void;
  /** Column whose absence stops the file being usable for updates. */
  identifierHeader?: string;
  disabled?: boolean;
  /** Read-only columns are dropped from a template, so it hides them. */
  hideReadOnly?: boolean;
}

function kindLabel(column: ColumnDescriptor): string | undefined {
  if (column.isLabel) return 'label, export only';
  if (column.readOnly) return 'read only';
  if (column.kind === 'relation') return 'relation';
  if (column.kind === 'media') return 'media';
  if (column.kind === 'dynamiczone') return 'JSON';
  return undefined;
}

export const ColumnPicker = ({
  columns,
  selected,
  onChange,
  identifierHeader,
  disabled,
  hideReadOnly,
}: ColumnPickerProps) => {
  const [search, setSearch] = useState('');

  const offered = useMemo(
    () => (hideReadOnly ? columns.filter((column) => !column.readOnly) : columns),
    [columns, hideReadOnly]
  );

  const visible = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (needle.length === 0) return offered;

    return offered.filter((column) => column.header.toLowerCase().includes(needle));
  }, [offered, search]);

  const chosen = useMemo(() => new Set(selected), [selected]);

  const toggle = (header: string) => {
    const next = new Set(chosen);
    if (next.has(header)) next.delete(header);
    else next.add(header);

    // Emitted in schema order rather than click order, so the file reads predictably.
    onChange(offered.filter((column) => next.has(column.header)).map((column) => column.header));
  };

  const setAll = (headers: ColumnDescriptor[]) =>
    onChange(headers.map((column) => column.header));

  const missingIdentifier =
    identifierHeader !== undefined &&
    offered.some((column) => column.header === identifierHeader) &&
    !chosen.has(identifierHeader);

  return (
    <Flex direction="column" alignItems="stretch" gap={3}>
      <Flex justifyContent="space-between" alignItems="center" gap={2} wrap="wrap">
        <Flex gap={2} alignItems="center">
          <Typography variant="pi" fontWeight="bold">
            Columns
          </Typography>
          <Badge>{`${chosen.size} of ${offered.length}`}</Badge>
        </Flex>

        <Flex gap={2}>
          <Button
            variant="tertiary"
            size="S"
            onClick={() => setAll(offered)}
            disabled={disabled || chosen.size === offered.length}
          >
            Select all
          </Button>
          <Button
            variant="tertiary"
            size="S"
            onClick={() => onChange([])}
            disabled={disabled || chosen.size === 0}
          >
            Clear
          </Button>
        </Flex>
      </Flex>

      <Searchbar
        name="column-search"
        value={search}
        onChange={(event: React.ChangeEvent<HTMLInputElement>) => setSearch(event.target.value)}
        onClear={() => setSearch('')}
        clearLabel="Clear the column search"
        placeholder="Find a column"
        disabled={disabled}
      >
        Find a column
      </Searchbar>

      {missingIdentifier ? (
        <Box
          padding={2}
          background="warning100"
          borderColor="warning200"
          borderStyle="solid"
          borderWidth="1px"
          hasRadius
        >
          <Typography variant="pi" textColor="warning700">
            {`"${identifierHeader}" is not selected. The file will still export, but it cannot be used to update these entries later — an import would create new ones instead.`}
          </Typography>
        </Box>
      ) : null}

      <Box
        overflow="auto"
        maxHeight="18rem"
        padding={2}
        background="neutral100"
        hasRadius
        borderColor="neutral200"
        borderStyle="solid"
        borderWidth="1px"
      >
        {visible.length === 0 ? (
          <Typography variant="pi" textColor="neutral600">
            No column matches that search.
          </Typography>
        ) : (
          <Flex direction="column" alignItems="stretch" gap={1}>
            {visible.map((column) => {
              const note = kindLabel(column);

              return (
                <Checkbox
                  key={column.header}
                  checked={chosen.has(column.header)}
                  onCheckedChange={() => toggle(column.header)}
                  disabled={disabled}
                >
                  <Flex gap={2} alignItems="center" wrap="wrap">
                    <Typography variant="pi">{column.header}</Typography>
                    {column.requiredInFile ? (
                      <Badge textColor="danger700" backgroundColor="danger100">
                        required
                      </Badge>
                    ) : null}
                    {note ? (
                      <Typography variant="pi" textColor="neutral600">
                        {note}
                      </Typography>
                    ) : null}
                  </Flex>
                </Checkbox>
              );
            })}
          </Flex>
        )}
      </Box>

      {chosen.size === 0 ? (
        <Typography variant="pi" textColor="neutral600">
          Nothing selected, so every column is included.
        </Typography>
      ) : null}
    </Flex>
  );
};
