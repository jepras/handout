export type DataModelTable = {
  description: string
  primary_key: string
  row_count_estimate: number
  visible_columns: number
  filtered_columns_count: number
}

export type DataModelSchema = {
  description: string
  tables: Record<string, DataModelTable>
}

export type DataModelResponse = {
  schemas: Record<string, DataModelSchema>
  governance_notes: string
}

export type ColumnSpec = {
  name: string
  type: string
  description?: string
  visible: boolean
  filtered_reason?: string
}

export type TableDescription = {
  schema: string
  table: string
  description: string
  primary_key: string
  row_count_estimate: number
  columns: ColumnSpec[]
}

export type QueryResponse = {
  data: Record<string, unknown>[]
  row_count: number
  total_available: number | null
  truncated: boolean
  mcp_governance: {
    filtered_columns: string[]
    requested_filtered_columns?: string[]
    hint?: string
  }
}

export type FilterOperator = 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte' | 'ilike' | 'in' | 'is'

export type FilterRow = {
  id: string
  column: string
  op: FilterOperator
  value: string
}

export type QueryFilterValue =
  | string
  | number
  | boolean
  | null
  | {
      op: FilterOperator
      value: string | number | boolean | null | Array<string | number | boolean>
    }

export type QueryFilters = Record<string, QueryFilterValue>

