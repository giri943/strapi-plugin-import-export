import { useEffect, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Flex,
  Loader,
  Modal,
  SingleSelect,
  SingleSelectOption,
  Table,
  Tbody,
  Td,
  Th,
  Thead,
  Tr,
  Typography,
} from '@strapi/design-system';
import {
  fetchCollectionDescription,
  type CollectionConfig,
  type CollectionDescription,
} from '../utils/api';

const NO_LABEL = '__none__';

interface RelationKeysDialogProps {
  uid: string;
  displayName: string;
  config: CollectionConfig;
  canEdit: boolean;
  onApply: (patch: Pick<CollectionConfig, 'relationLookupKeys' | 'relationLabelKeys'>) => void;
  onClose: () => void;
}

/**
 * Per-target configuration for the two keys a relation column needs.
 *
 * They are separate settings because they answer different questions: the match key has to
 * identify exactly one entry so an import can find it, while the label only has to be readable.
 */
export const RelationKeysDialog = ({
  uid,
  displayName,
  config,
  canEdit,
  onApply,
  onClose,
}: RelationKeysDialogProps) => {
  const [description, setDescription] = useState<CollectionDescription | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lookupKeys, setLookupKeys] = useState<Record<string, string>>(
    config.relationLookupKeys ?? {}
  );
  const [labelKeys, setLabelKeys] = useState<Record<string, string>>(
    config.relationLabelKeys ?? {}
  );

  useEffect(() => {
    let active = true;

    fetchCollectionDescription(uid)
      .then((response) => {
        if (active) setDescription(response);
      })
      .catch((cause: unknown) => {
        if (active) setError(cause instanceof Error ? cause.message : 'Could not read the schema.');
      });

    return () => {
      active = false;
    };
  }, [uid]);

  const apply = () => {
    onApply({ relationLookupKeys: lookupKeys, relationLabelKeys: labelKeys });
    onClose();
  };

  return (
    <Modal.Root open onOpenChange={(open: boolean) => (open ? undefined : onClose())}>
      <Modal.Content>
        <Modal.Header>
          <Modal.Title>{`Relation columns for ${displayName}`}</Modal.Title>
        </Modal.Header>

        <Modal.Body>
          <Flex direction="column" alignItems="stretch" gap={4}>
            {error ? (
              <Alert closeLabel="Close" onClose={() => setError(null)} title="Problem" variant="danger">
                {error}
              </Alert>
            ) : null}

            <Typography variant="pi" textColor="neutral600">
              Each relation gets two columns. <strong>Match on</strong> is written as the importable
              value and has to identify a single entry, so only unique fields are offered.{' '}
              <strong>Label</strong> is a second, read-only column that exists so an export can be
              read by a person — it does not need to be unique and is ignored on import.
            </Typography>

            {!description ? (
              <Flex justifyContent="center" padding={6}>
                <Loader small>Reading the schema</Loader>
              </Flex>
            ) : description.relationTargets.length === 0 ? (
              <Typography textColor="neutral600">
                This collection has no relations to configure.
              </Typography>
            ) : (
              <Table colCount={3} rowCount={description.relationTargets.length}>
                <Thead>
                  <Tr>
                    <Th>
                      <Typography variant="sigma">Related collection</Typography>
                    </Th>
                    <Th>
                      <Typography variant="sigma">Match on</Typography>
                    </Th>
                    <Th>
                      <Typography variant="sigma">Label column</Typography>
                    </Th>
                  </Tr>
                </Thead>
                <Tbody>
                  {description.relationTargets.map((target) => {
                    const currentLabel =
                      labelKeys[target.uid] !== undefined
                        ? labelKeys[target.uid]
                        : (target.suggestedLabelKey ?? '');

                    return (
                      <Tr key={target.uid}>
                        <Td>
                          <Flex direction="column" alignItems="flex-start">
                            <Typography fontWeight="semiBold">{target.displayName}</Typography>
                            <Typography variant="pi" textColor="neutral600">
                              {target.uid}
                            </Typography>
                          </Flex>
                        </Td>
                        <Td>
                          <SingleSelect
                            value={lookupKeys[target.uid] ?? 'documentId'}
                            onChange={(value: string | number) =>
                              setLookupKeys({ ...lookupKeys, [target.uid]: String(value) })
                            }
                            disabled={!canEdit}
                            size="S"
                          >
                            {target.lookupKeys.map((key) => (
                              <SingleSelectOption key={key} value={key}>
                                {key}
                              </SingleSelectOption>
                            ))}
                          </SingleSelect>
                        </Td>
                        <Td>
                          <SingleSelect
                            value={currentLabel === '' ? NO_LABEL : currentLabel}
                            onChange={(value: string | number) =>
                              setLabelKeys({
                                ...labelKeys,
                                [target.uid]: String(value) === NO_LABEL ? '' : String(value),
                              })
                            }
                            disabled={!canEdit}
                            size="S"
                          >
                            <SingleSelectOption value={NO_LABEL}>
                              none — id column only
                            </SingleSelectOption>
                            {target.labelKeys.map((key) => (
                              <SingleSelectOption key={key} value={key}>
                                {key}
                                {key === target.suggestedLabelKey ? '  (suggested)' : ''}
                              </SingleSelectOption>
                            ))}
                          </SingleSelect>
                        </Td>
                      </Tr>
                    );
                  })}
                </Tbody>
              </Table>
            )}

            {description && description.unsupported.length > 0 ? (
              <Box>
                <Typography variant="pi" fontWeight="bold">
                  Fields left out of this collection
                </Typography>
                {description.unsupported.map((entry) => (
                  <Typography key={entry.field} variant="pi" textColor="neutral600" tag="p">
                    {`${entry.field} — ${entry.reason}`}
                  </Typography>
                ))}
              </Box>
            ) : null}
          </Flex>
        </Modal.Body>

        <Modal.Footer>
          <Button variant="tertiary" onClick={onClose}>
            Cancel
          </Button>
          {canEdit ? (
            <Button onClick={apply} disabled={!description}>
              Apply
            </Button>
          ) : null}
        </Modal.Footer>
      </Modal.Content>
    </Modal.Root>
  );
};
