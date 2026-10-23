import { stringify } from 'csv-stringify/sync';
import type { Core } from '@strapi/strapi';
import { UTF8_BOM, escapeFormula } from '../core/csv';
import type { ColumnDescriptor } from '../core/types';
import type { PluginSettings } from './settings';

export interface TemplateFile {
  fileName: string;
  content: string;
}

function kindLabel(column: ColumnDescriptor): string {
  switch (column.kind) {
    case 'meta':
      return 'built-in';
    case 'relation':
      return 'relation';
    case 'media':
      return 'media';
    case 'dynamiczone':
      return 'dynamic zone (JSON)';
    case 'json':
      return 'JSON';
    default:
      return column.attribute?.type ?? 'text';
  }
}

function safeFileName(uid: string, suffix: string): string {
  const base = uid.replace(/[^A-Za-z0-9._-]/g, '-');
  return `${base}-${suffix}.csv`;
}

export default ({ strapi }: { strapi: Core.Strapi }) => {
  void strapi;

  return {
    /**
     * The template carries headers and nothing else.
     *
     * A sample data row would be convenient, but every operator who forgets to delete it imports
     * it, and a half-valid placeholder row is worse than an empty file.
     */
    buildTemplate(
      uid: string,
      columns: readonly ColumnDescriptor[],
      settings: PluginSettings
    ): TemplateFile {
      const importable = columns.filter((column) => !column.readOnly);

      const content = stringify([importable.map((column) => column.header)], {
        delimiter: settings.csvDelimiter,
        record_delimiter: 'windows',
      });

      return {
        fileName: safeFileName(uid, 'template'),
        content: settings.includeBom ? `${UTF8_BOM}${content}` : content,
      };
    },

    /** A companion file describing each column, so the rules travel with the template. */
    buildGuide(
      uid: string,
      columns: readonly ColumnDescriptor[],
      settings: PluginSettings
    ): TemplateFile {
      const rows: string[][] = [['column', 'type', 'required', 'accepts many', 'notes']];

      for (const column of columns) {
        const notes = column.readOnly
          ? `Read only. ${column.hint ?? ''}`.trim()
          : (column.hint ?? '');

        rows.push([
          column.header,
          kindLabel(column),
          column.required ? 'yes' : 'no',
          column.multiple ? `yes, separated by "${settings.multiValueDelimiter}"` : 'no',
          settings.escapeFormulas ? escapeFormula(notes) : notes,
        ]);
      }

      const content = stringify(rows, {
        delimiter: settings.csvDelimiter,
        record_delimiter: 'windows',
      });

      return {
        fileName: safeFileName(uid, 'guide'),
        content: settings.includeBom ? `${UTF8_BOM}${content}` : content,
      };
    },
  };
};
