import exportService from './export';
import importService from './import';
import jobs from './jobs';
import rbac from './rbac';
import schema from './schema';
import settings from './settings';
import template from './template';

export default {
  settings,
  schema,
  rbac,
  template,
  export: exportService,
  import: importService,
  jobs,
};
