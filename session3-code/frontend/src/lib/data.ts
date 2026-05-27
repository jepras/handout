import type { ColumnSpec, FilterRow, QueryFilters } from '../types/nordpension'

export const numberFormatter = new Intl.NumberFormat('da-DK')

export const currencyFormatter = new Intl.NumberFormat('da-DK', {
  style: 'currency',
  currency: 'DKK',
  maximumFractionDigits: 0,
})

export const percentFormatter = new Intl.NumberFormat('da-DK', {
  maximumFractionDigits: 2,
})

export function isNumericColumn(column: ColumnSpec): boolean {
  return ['int', 'numeric', 'float', 'double', 'real'].some((type) => column.type.includes(type))
}

export function isDateColumn(column: ColumnSpec): boolean {
  return column.type.includes('date') || column.type.includes('time')
}

export function isBooleanColumn(column: ColumnSpec): boolean {
  return column.type.includes('bool')
}

export function visibleColumns(columns: ColumnSpec[]): ColumnSpec[] {
  return columns.filter((column) => column.visible)
}

export function formatCell(value: unknown): string {
  if (value === null || value === undefined) return '—'
  if (typeof value === 'boolean') return value ? 'Ja' : 'Nej'
  if (typeof value === 'number') return numberFormatter.format(value)
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value)) return value.slice(0, 10)
  if (Array.isArray(value)) return value.join(', ')
  return String(value)
}

function coerceValue(raw: string, column?: ColumnSpec): string | number | boolean | null {
  const value = raw.trim()
  if (!value) return ''
  if (value.toLowerCase() === 'null') return null
  if (column && isBooleanColumn(column)) return ['true', 'ja', '1'].includes(value.toLowerCase())
  if (column && isNumericColumn(column)) {
    const parsed = Number(value.replace(',', '.'))
    return Number.isFinite(parsed) ? parsed : value
  }
  return value
}

export function buildQueryFilters(rows: FilterRow[], columns: ColumnSpec[]): QueryFilters {
  const byName = new Map(columns.map((column) => [column.name, column]))
  const filters: QueryFilters = {}

  for (const row of rows) {
    if (!row.column) continue
    const column = byName.get(row.column)
    const trimmed = row.value.trim()

    if (row.op === 'is') {
      filters[row.column] = { op: 'is', value: trimmed ? coerceValue(trimmed, column) : null }
      continue
    }

    if (!trimmed) continue

    if (row.op === 'eq') {
      filters[row.column] = coerceValue(trimmed, column)
      continue
    }

    if (row.op === 'in') {
      filters[row.column] = {
        op: 'in',
        value: trimmed
          .split(',')
          .map((item) => coerceValue(item, column))
          .filter((item): item is string | number | boolean => item !== '' && item !== null),
      }
      continue
    }

    filters[row.column] = {
      op: row.op,
      value: row.op === 'ilike' ? `%${trimmed}%` : coerceValue(trimmed, column),
    }
  }

  return filters
}

export function bestDefaultColumns(columns: ColumnSpec[]): string[] {
  const visible = visibleColumns(columns)
  const preferred = visible
    .filter((column) => !column.name.endsWith('_md') && !column.name.includes('description'))
    .slice(0, 12)
    .map((column) => column.name)

  return preferred.length ? preferred : visible.slice(0, 12).map((column) => column.name)
}
