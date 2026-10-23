import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Badge,
  Box,
  Button,
  Field,
  Flex,
  Loader,
  MultiSelect,
  MultiSelectOption,
  SingleSelect,
  SingleSelectOption,
  Typography,
} from '@strapi/design-system';
import { Plus, Trash } from '@strapi/icons';
import { fetchRelationOptions, type DateFilter, type RelationOption } from '../utils/api';

export interface RelationFilterDraft {
  field: string;
  documentIds: string[];
}

export interface DateFilterDraft {
  field: string;
  from: string;
  to: string;
}

interface ExportFiltersProps {
  uid: string;
  filterableRelations: string[];
  filterableDates: string[];
  relationFilters: RelationFilterDraft[];
  dateFilters: DateFilterDraft[];
  onRelationFiltersChange: (filters: RelationFilterDraft[]) => void;
  onDateFiltersChange: (filters: DateFilterDraft[]) => void;
  disabled?: boolean;
  onError?: (message: string) => void;
}

/** One relation filter: pick the field, then pick any number of its values. */
const RelationFilterRow = ({
  uid,
  field,
  documentIds,
  availableFields,
  onChange,
  onRemove,
  disabled,
  onError,
}: {
  uid: string;
  field: string;
  documentIds: string[];
  availableFields: string[];
  onChange: (next: RelationFilterDraft) => void;
  onRemove: () => void;
  disabled?: boolean;
  onError?: (message: string) => void;
}) => {
  const [options, setOptions] = useState<RelationOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [labelKey, setLabelKey] = useState<string>('');

  const load = useCallback(async () => {
    if (!field) {
      setOptions([]);
      return;
    }

    setLoading(true);
    try {
      const response = await fetchRelationOptions(uid, field, { pageSize: 200 });
      setOptions(response.options);
      setLabelKey(response.labelKey);
    } catch (cause) {
      setOptions([]);
      onError?.(cause instanceof Error ? cause.message : 'Could not load the filter values.');
    } finally {
      setLoading(false);
    }
  }, [uid, field, onError]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <Box
      padding={3}
      background="neutral100"
      hasRadius
      borderColor="neutral200"
      borderStyle="solid"
      borderWidth="1px"
    >
      <Flex gap={3} alignItems="flex-end" wrap="wrap">
        <Box minWidth="12rem">
          <Field.Root name={`filter-field-${field || 'new'}`}>
            <Field.Label>Field</Field.Label>
            <SingleSelect
              value={field}
              onChange={(value: string | number) =>
                onChange({ field: String(value), documentIds: [] })
              }
              disabled={disabled}
            >
              {availableFields.map((candidate) => (
                <SingleSelectOption key={candidate} value={candidate}>
                  {candidate}
                </SingleSelectOption>
              ))}
            </SingleSelect>
          </Field.Root>
        </Box>

        <Box flex="1" minWidth="18rem">
          <Field.Root
            name={`filter-values-${field || 'new'}`}
            hint={
              field
                ? `Matching any of these${labelKey ? ` (shown by ${labelKey})` : ''}.`
                : 'Choose a field first.'
            }
          >
            <Field.Label>Values</Field.Label>
            {loading ? (
              <Flex gap={2} alignItems="center" paddingTop={2} paddingBottom={2}>
                <Loader small />
                <Typography variant="pi">Loading values</Typography>
              </Flex>
            ) : (
              <MultiSelect
                value={documentIds}
                onChange={(value: string[]) => onChange({ field, documentIds: value ?? [] })}
                disabled={disabled || !field || options.length === 0}
                placeholder={options.length === 0 ? 'No values available' : 'Any'}
                withTags
              >
                {options.map((option) => (
                  <MultiSelectOption key={option.documentId} value={option.documentId}>
                    {option.label}
                  </MultiSelectOption>
                ))}
              </MultiSelect>
            )}
            <Field.Hint />
          </Field.Root>
        </Box>

        <Button variant="danger-light" startIcon={<Trash />} onClick={onRemove} disabled={disabled}>
          Remove
        </Button>
      </Flex>
    </Box>
  );
};

export const ExportFilters = ({
  uid,
  filterableRelations,
  filterableDates,
  relationFilters,
  dateFilters,
  onRelationFiltersChange,
  onDateFiltersChange,
  disabled,
  onError,
}: ExportFiltersProps) => {
  const usedFields = useMemo(
    () => new Set(relationFilters.map((filter) => filter.field).filter(Boolean)),
    [relationFilters]
  );

  const spareField = filterableRelations.find((field) => !usedFields.has(field));

  const activeCount =
    relationFilters.filter((filter) => filter.field && filter.documentIds.length > 0).length +
    dateFilters.filter((filter) => filter.field && (filter.from || filter.to)).length;

  const updateRelation = (index: number, next: RelationFilterDraft) => {
    onRelationFiltersChange(
      relationFilters.map((filter, i) => (i === index ? next : filter))
    );
  };

  const updateDate = (index: number, patch: Partial<DateFilterDraft>) => {
    onDateFiltersChange(
      dateFilters.map((filter, i) => (i === index ? { ...filter, ...patch } : filter))
    );
  };

  return (
    <Flex direction="column" alignItems="stretch" gap={3}>
      <Flex justifyContent="space-between" alignItems="center" gap={2} wrap="wrap">
        <Flex gap={2} alignItems="center">
          <Typography variant="pi" fontWeight="bold">
            Filters
          </Typography>
          {activeCount > 0 ? (
            <Badge textColor="primary700" backgroundColor="primary100">
              {`${activeCount} active`}
            </Badge>
          ) : (
            <Typography variant="pi" textColor="neutral600">
              none — exporting everything
            </Typography>
          )}
        </Flex>

        <Flex gap={2}>
          {spareField ? (
            <Button
              variant="secondary"
              size="S"
              startIcon={<Plus />}
              onClick={() =>
                onRelationFiltersChange([
                  ...relationFilters,
                  { field: spareField, documentIds: [] },
                ])
              }
              disabled={disabled}
            >
              Relation
            </Button>
          ) : null}

          {filterableDates.length > 0 ? (
            <Button
              variant="secondary"
              size="S"
              startIcon={<Plus />}
              onClick={() =>
                onDateFiltersChange([
                  ...dateFilters,
                  { field: filterableDates[0] ?? 'createdAt', from: '', to: '' },
                ])
              }
              disabled={disabled}
            >
              Date range
            </Button>
          ) : null}
        </Flex>
      </Flex>

      {filterableRelations.length === 0 ? (
        <Typography variant="pi" textColor="neutral600">
          This collection has no relation that can be filtered on.
        </Typography>
      ) : null}

      {relationFilters.map((filter, index) => (
        <RelationFilterRow
          key={`${filter.field}-${index}`}
          uid={uid}
          field={filter.field}
          documentIds={filter.documentIds}
          availableFields={filterableRelations.filter(
            (candidate) => candidate === filter.field || !usedFields.has(candidate)
          )}
          onChange={(next) => updateRelation(index, next)}
          onRemove={() =>
            onRelationFiltersChange(relationFilters.filter((_, i) => i !== index))
          }
          disabled={disabled}
          onError={onError}
        />
      ))}

      {dateFilters.map((filter, index) => (
        <Box
          key={`${filter.field}-${index}`}
          padding={3}
          background="neutral100"
          hasRadius
          borderColor="neutral200"
          borderStyle="solid"
          borderWidth="1px"
        >
          <Flex gap={3} alignItems="flex-end" wrap="wrap">
            <Box minWidth="12rem">
              <Field.Root name={`date-field-${index}`}>
                <Field.Label>Date field</Field.Label>
                <SingleSelect
                  value={filter.field}
                  onChange={(value: string | number) => updateDate(index, { field: String(value) })}
                  disabled={disabled}
                >
                  {filterableDates.map((candidate) => (
                    <SingleSelectOption key={candidate} value={candidate}>
                      {candidate}
                    </SingleSelectOption>
                  ))}
                </SingleSelect>
              </Field.Root>
            </Box>

            <Box minWidth="11rem">
              <Field.Root name={`date-from-${index}`}>
                <Field.Label>From</Field.Label>
                <Field.Input
                  type="date"
                  value={filter.from}
                  onChange={(event: React.ChangeEvent<HTMLInputElement>) =>
                    updateDate(index, { from: event.target.value })
                  }
                  disabled={disabled}
                />
              </Field.Root>
            </Box>

            <Box minWidth="11rem">
              <Field.Root name={`date-to-${index}`} hint="Includes the whole of this day.">
                <Field.Label>To</Field.Label>
                <Field.Input
                  type="date"
                  value={filter.to}
                  onChange={(event: React.ChangeEvent<HTMLInputElement>) =>
                    updateDate(index, { to: event.target.value })
                  }
                  disabled={disabled}
                />
                <Field.Hint />
              </Field.Root>
            </Box>

            <Button
              variant="danger-light"
              startIcon={<Trash />}
              onClick={() => onDateFiltersChange(dateFilters.filter((_, i) => i !== index))}
              disabled={disabled}
            >
              Remove
            </Button>
          </Flex>
        </Box>
      ))}
    </Flex>
  );
};

/** Drops the incomplete rows a user leaves behind while choosing. */
export function toRelationPayload(filters: readonly RelationFilterDraft[]) {
  return filters
    .filter((filter) => filter.field && filter.documentIds.length > 0)
    .map((filter) => ({ field: filter.field, documentIds: filter.documentIds }));
}

export function toDatePayload(filters: readonly DateFilterDraft[]): DateFilter[] {
  return filters
    .filter((filter) => filter.field && (filter.from || filter.to))
    .map((filter) => ({
      field: filter.field,
      from: filter.from || undefined,
      to: filter.to || undefined,
    }));
}
