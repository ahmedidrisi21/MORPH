export {
  computeSalesFacts,
  customerNames,
  FILTER_IDS,
  type FilterId,
  tsFactsEngine,
} from "./engine";
export { parseSalesCsv, SalesRowSchema } from "./parse";
export type { SalesCustomer, SalesFacts, SalesMonth, SalesRow, SalesSegment } from "./types";
export {
  COLUMN_ROLES,
  type ColumnMapping,
  ColumnMappingSchema,
  type ColumnRole,
  type CsvTable,
  CsvUploadError,
  MAX_UPLOAD_BYTES,
  missingRoles,
  type PartialMapping,
  parseDateValue,
  parseNumberValue,
  REQUIRED_ROLES,
  ROLE_LABEL,
  readCsvTable,
  rowsFromMapping,
  suggestMapping,
  type UploadedDataset,
} from "./upload";
