import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  AlertCircle,
  BarChart3,
  ChevronLeft,
  ChevronRight,
  Database,
  Filter,
  LineChart as LineChartIcon,
  Loader2,
  PieChart as PieChartIcon,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  Table2,
  X,
} from 'lucide-react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import './App.css'
import { buildQueryFilters, bestDefaultColumns, formatCell, isDateColumn, isNumericColumn, numberFormatter, visibleColumns } from './lib/data'
import { callMcpTool } from './lib/mcp'
import type { ColumnSpec, DataModelResponse, FilterOperator, FilterRow, QueryResponse, TableDescription } from './types/nordpension'

type ChartMode = 'bar' | 'line' | 'pie'
type Aggregation = 'count' | 'sum' | 'avg'

const filterOperators: Array<{ value: FilterOperator; label: string }> = [
  { value: 'eq', label: '=' },
  { value: 'neq', label: '!=' },
  { value: 'gt', label: '>' },
  { value: 'gte', label: '>=' },
  { value: 'lt', label: '<' },
  { value: 'lte', label: '<=' },
  { value: 'ilike', label: 'indeholder' },
  { value: 'in', label: 'i liste' },
  { value: 'is', label: 'er null' },
]

const limitOptions = [50, 100, 250, 500]
const chartColors = ['#8d1b3d', '#0f766e', '#b7791f', '#2563eb', '#7c3aed', '#475569', '#be123c', '#15803d']

function makeFilterRow(columns: ColumnSpec[]): FilterRow {
  return {
    id: crypto.randomUUID(),
    column: visibleColumns(columns)[0]?.name ?? '',
    op: 'eq',
    value: '',
  }
}

function schemaLabel(schema: string): string {
  const labels: Record<string, string> = {
    medlem: 'Medlem',
    crm: 'CRM',
    erp: 'ERP',
    dwh: 'Data warehouse',
    kms: 'Knowledge',
  }
  return labels[schema] ?? schema
}

function compactNumber(value: number): string {
  return new Intl.NumberFormat('da-DK', {
    notation: Math.abs(value) >= 10000 ? 'compact' : 'standard',
    maximumFractionDigits: 1,
  }).format(value)
}

function toNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value.replace(',', '.'))
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

function groupChartRows(
  rows: Record<string, unknown>[],
  dimension: string,
  metric: string,
  aggregation: Aggregation,
) {
  const grouped = new Map<string, { label: string; value: number; count: number }>()

  for (const row of rows) {
    const label = formatCell(row[dimension])
    const existing = grouped.get(label) ?? { label, value: 0, count: 0 }
    existing.count += 1

    if (aggregation === 'count' || !metric) {
      existing.value += 1
    } else {
      existing.value += toNumber(row[metric]) ?? 0
    }
    grouped.set(label, existing)
  }

  return Array.from(grouped.values())
    .map((item) => ({
      label: item.label.length > 24 ? `${item.label.slice(0, 21)}...` : item.label,
      value: aggregation === 'avg' && item.count ? item.value / item.count : item.value,
      count: item.count,
    }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 12)
}

function lineChartRows(
  rows: Record<string, unknown>[],
  dimension: string,
  metric: string,
  aggregation: Aggregation,
) {
  const data = groupChartRows(rows, dimension, metric, aggregation)
  return data.sort((a, b) => a.label.localeCompare(b.label, 'da-DK'))
}

function App() {
  const [model, setModel] = useState<DataModelResponse | null>(null)
  const [selectedSchema, setSelectedSchema] = useState('')
  const [selectedTable, setSelectedTable] = useState('')
  const [description, setDescription] = useState<TableDescription | null>(null)
  const [selectedColumns, setSelectedColumns] = useState<string[]>([])
  const [filters, setFilters] = useState<FilterRow[]>([])
  const [queryResult, setQueryResult] = useState<QueryResponse | null>(null)
  const [limit, setLimit] = useState(100)
  const [offset, setOffset] = useState(0)
  const [orderColumn, setOrderColumn] = useState('')
  const [orderDirection, setOrderDirection] = useState<'asc' | 'desc'>('asc')
  const [chartMode, setChartMode] = useState<ChartMode>('bar')
  const [chartDimension, setChartDimension] = useState('')
  const [chartMetric, setChartMetric] = useState('')
  const [aggregation, setAggregation] = useState<Aggregation>('count')
  const [loadingModel, setLoadingModel] = useState(true)
  const [loadingTable, setLoadingTable] = useState(false)
  const [loadingRows, setLoadingRows] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const schemaNames = useMemo(() => (model ? Object.keys(model.schemas) : []), [model])
  const selectedSchemaModel = selectedSchema && model ? model.schemas[selectedSchema] : null
  const tableNames = useMemo(() => (selectedSchemaModel ? Object.keys(selectedSchemaModel.tables) : []), [selectedSchemaModel])
  const rows = useMemo(() => queryResult?.data ?? [], [queryResult])
  const columns = useMemo(() => visibleColumns(description?.columns ?? []), [description])
  const numericColumns = useMemo(() => columns.filter(isNumericColumn), [columns])
  const dateColumns = useMemo(() => columns.filter(isDateColumn), [columns])
  const dimensionColumns = useMemo(() => columns.filter((column) => !isNumericColumn(column)), [columns])
  const chartableDimensions = useMemo(
    () =>
      dimensionColumns.filter(
        (column) =>
          column.name !== description?.primary_key &&
          !column.name.endsWith('_id') &&
          !column.name.includes('description') &&
          !column.name.endsWith('_md'),
      ),
    [description, dimensionColumns],
  )
  const chartDimensionOptions = useMemo(() => {
    if (chartMode === 'line' && dateColumns.length) return dateColumns
    if (chartableDimensions.length) return chartableDimensions
    if (dimensionColumns.length) return dimensionColumns
    return columns
  }, [chartMode, chartableDimensions, columns, dateColumns, dimensionColumns])
  const effectiveChartDimension = chartDimensionOptions.some((column) => column.name === chartDimension)
    ? chartDimension
    : chartDimensionOptions[0]?.name ?? ''
  const effectiveChartMetric = numericColumns.some((column) => column.name === chartMetric)
    ? chartMetric
    : numericColumns[0]?.name ?? ''
  const effectiveAggregation: Aggregation = numericColumns.length ? aggregation : 'count'

  const runQuery = useCallback(
    async (nextOffset: number, nextColumns = selectedColumns, nextFilters = filters) => {
      if (!description || !selectedSchema || !selectedTable) return

      const select = nextColumns.length ? nextColumns : bestDefaultColumns(description.columns)
      setLoadingRows(true)
      setError(null)

      try {
        const result = await callMcpTool<QueryResponse>('query', {
          schema: selectedSchema,
          table: selectedTable,
          filters: buildQueryFilters(nextFilters, description.columns),
          select,
          order: orderColumn ? `${orderColumn}.${orderDirection}` : undefined,
          limit,
          offset: nextOffset,
        })
        setQueryResult(result)
        setOffset(nextOffset)
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : String(caught))
      } finally {
        setLoadingRows(false)
      }
    },
    [description, filters, limit, orderColumn, orderDirection, selectedColumns, selectedSchema, selectedTable],
  )

  useEffect(() => {
    let cancelled = false

    async function loadModel() {
      setLoadingModel(true)
      setError(null)
      try {
        const nextModel = await callMcpTool<DataModelResponse>('list_data_model')
        if (cancelled) return
        const firstSchema = Object.keys(nextModel.schemas)[0] ?? ''
        const firstTable = firstSchema ? Object.keys(nextModel.schemas[firstSchema].tables)[0] ?? '' : ''
        setModel(nextModel)
        setSelectedSchema(firstSchema)
        setSelectedTable(firstTable)
      } catch (caught) {
        if (!cancelled) setError(caught instanceof Error ? caught.message : String(caught))
      } finally {
        if (!cancelled) setLoadingModel(false)
      }
    }

    loadModel()
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (!selectedSchema || !selectedTable) return
    let cancelled = false

    async function loadTable() {
      setLoadingTable(true)
      setQueryResult(null)
      setDescription(null)
      setOffset(0)
      setError(null)

      try {
        const nextDescription = await callMcpTool<TableDescription>('describe_table', {
          schema: selectedSchema,
          table: selectedTable,
        })
        if (cancelled) return

        const nextColumns = bestDefaultColumns(nextDescription.columns)
        setDescription(nextDescription)
        setSelectedColumns(nextColumns)
        setFilters([])
        setOrderColumn('')

        const result = await callMcpTool<QueryResponse>('query', {
          schema: selectedSchema,
          table: selectedTable,
          select: nextColumns,
          limit,
          offset: 0,
        })
        if (cancelled) return
        setQueryResult(result)
      } catch (caught) {
        if (!cancelled) setError(caught instanceof Error ? caught.message : String(caught))
      } finally {
        if (!cancelled) setLoadingTable(false)
      }
    }

    loadTable()
    return () => {
      cancelled = true
    }
  }, [limit, selectedSchema, selectedTable])

  const chartData = useMemo(() => {
    if (!effectiveChartDimension || rows.length === 0) return []
    if (chartMode === 'line') return lineChartRows(rows, effectiveChartDimension, effectiveChartMetric, effectiveAggregation)
    return groupChartRows(rows, effectiveChartDimension, effectiveChartMetric, effectiveAggregation)
  }, [effectiveAggregation, effectiveChartDimension, effectiveChartMetric, chartMode, rows])

  const activeTableModel = selectedSchemaModel?.tables[selectedTable]
  const totalRows = queryResult?.total_available ?? activeTableModel?.row_count_estimate ?? 0
  const pageStart = rows.length ? offset + 1 : 0
  const pageEnd = offset + rows.length
  const canPageBack = offset > 0
  const canPageForward = queryResult?.truncated ?? false
  const filteredColumns = description?.columns.filter((column) => !column.visible) ?? []

  function handleSchemaChange(schema: string) {
    const firstTable = model ? Object.keys(model.schemas[schema].tables)[0] ?? '' : ''
    setSelectedSchema(schema)
    setSelectedTable(firstTable)
  }

  function addFilter() {
    if (!description) return
    setFilters((current) => [...current, makeFilterRow(description.columns)])
  }

  function updateFilter(id: string, patch: Partial<FilterRow>) {
    setFilters((current) => current.map((row) => (row.id === id ? { ...row, ...patch } : row)))
  }

  function removeFilter(id: string) {
    setFilters((current) => current.filter((row) => row.id !== id))
  }

  function toggleColumn(column: string) {
    setSelectedColumns((current) => {
      if (current.includes(column)) {
        const next = current.filter((item) => item !== column)
        return next.length ? next : current
      }
      return [...current, column]
    })
  }

  function resetFilters() {
    setFilters([])
    void runQuery(0, selectedColumns, [])
  }

  const mainContent = (() => {
    if (loadingModel) {
      return (
        <div className="empty-state">
          <Loader2 className="spin" aria-hidden="true" />
          <span>Forbinder til Nordpension MCP</span>
        </div>
      )
    }

    if (!description && (loadingTable || error)) {
      return (
        <div className="empty-state">
          <AlertCircle aria-hidden="true" />
          <span>{error ?? 'Indlæser tabel'}</span>
        </div>
      )
    }

    if (!description) return null

    return (
      <>
        <header className="content-header">
          <div>
            <div className="eyebrow">{schemaLabel(selectedSchema)}</div>
            <h1>{selectedTable}</h1>
            <p>{description.description}</p>
          </div>
          <button className="button primary" type="button" onClick={() => void runQuery(offset)} disabled={loadingRows || loadingTable}>
            <RefreshCw size={16} className={loadingRows || loadingTable ? 'spin' : ''} aria-hidden="true" />
            Opdater
          </button>
        </header>

        {error && (
          <div className="alert" role="alert">
            <AlertCircle size={18} aria-hidden="true" />
            <span>{error}</span>
          </div>
        )}

        <section className="metric-grid" aria-label="Nøgletal">
          <div className="metric-tile">
            <span>Rækker</span>
            <strong>{compactNumber(totalRows)}</strong>
          </div>
          <div className="metric-tile">
            <span>Aktuel side</span>
            <strong>{numberFormatter.format(rows.length)}</strong>
          </div>
          <div className="metric-tile">
            <span>Synlige kolonner</span>
            <strong>{columns.length}</strong>
          </div>
          <div className="metric-tile">
            <span>Filtreret af MCP</span>
            <strong>{filteredColumns.length}</strong>
          </div>
        </section>

        <section className="panel">
          <div className="panel-heading">
            <div>
              <h2>Filtre</h2>
              <span>{filters.length ? `${filters.length} aktive` : 'Ingen aktive'}</span>
            </div>
            <div className="button-row">
              <button className="button secondary" type="button" onClick={addFilter}>
                <Plus size={16} aria-hidden="true" />
                Tilføj
              </button>
              <button className="button primary" type="button" onClick={() => void runQuery(0)} disabled={loadingRows}>
                <Filter size={16} aria-hidden="true" />
                Anvend
              </button>
            </div>
          </div>

          {filters.length === 0 ? (
            <div className="filter-empty">
              <Search size={18} aria-hidden="true" />
              <span>Alle rækker</span>
            </div>
          ) : (
            <div className="filter-list">
              {filters.map((filter) => (
                <div className="filter-row" key={filter.id}>
                  <select value={filter.column} onChange={(event) => updateFilter(filter.id, { column: event.target.value })}>
                    {columns.map((column) => (
                      <option key={column.name} value={column.name}>
                        {column.name}
                      </option>
                    ))}
                  </select>
                  <select value={filter.op} onChange={(event) => updateFilter(filter.id, { op: event.target.value as FilterOperator })}>
                    {filterOperators.map((operator) => (
                      <option key={operator.value} value={operator.value}>
                        {operator.label}
                      </option>
                    ))}
                  </select>
                  <input
                    value={filter.value}
                    onChange={(event) => updateFilter(filter.id, { value: event.target.value })}
                    placeholder={filter.op === 'in' ? 'A, B, C' : 'værdi'}
                    disabled={filter.op === 'is'}
                  />
                  <button className="icon-button" type="button" onClick={() => removeFilter(filter.id)} aria-label="Fjern filter">
                    <X size={16} aria-hidden="true" />
                  </button>
                </div>
              ))}
              <button className="button ghost" type="button" onClick={resetFilters}>
                Nulstil filtre
              </button>
            </div>
          )}
        </section>

        <section className="panel chart-panel">
          <div className="panel-heading">
            <div>
              <h2>Diagram</h2>
              <span>{chartData.length ? `${chartData.length} grupper` : 'Ingen data'}</span>
            </div>
            <div className="segmented" aria-label="Diagramtype">
              <button className={chartMode === 'bar' ? 'active' : ''} type="button" onClick={() => setChartMode('bar')}>
                <BarChart3 size={16} aria-hidden="true" />
                Søjler
              </button>
              <button className={chartMode === 'line' ? 'active' : ''} type="button" onClick={() => setChartMode('line')}>
                <LineChartIcon size={16} aria-hidden="true" />
                Linje
              </button>
              <button className={chartMode === 'pie' ? 'active' : ''} type="button" onClick={() => setChartMode('pie')}>
                <PieChartIcon size={16} aria-hidden="true" />
                Fordeling
              </button>
            </div>
          </div>

          <div className="chart-controls">
            <label>
              Dimension
              <select value={effectiveChartDimension} onChange={(event) => setChartDimension(event.target.value)}>
                {chartDimensionOptions.map((column) => (
                  <option key={column.name} value={column.name}>
                    {column.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Måltal
              <select value={effectiveAggregation} onChange={(event) => setAggregation(event.target.value as Aggregation)}>
                <option value="count">Antal</option>
                <option value="sum" disabled={!numericColumns.length}>
                  Sum
                </option>
                <option value="avg" disabled={!numericColumns.length}>
                  Gennemsnit
                </option>
              </select>
            </label>
            <label>
              Kolonne
              <select value={effectiveChartMetric} onChange={(event) => setChartMetric(event.target.value)} disabled={effectiveAggregation === 'count' || !numericColumns.length}>
                {numericColumns.map((column) => (
                  <option key={column.name} value={column.name}>
                    {column.name}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="chart-frame">
            {chartData.length === 0 ? (
              <div className="empty-chart">Ingen rækker på den aktuelle side</div>
            ) : (
              <ResponsiveContainer width="100%" height={300}>
                {chartMode === 'pie' ? (
                  <PieChart>
                    <Tooltip formatter={(value) => numberFormatter.format(Number(value))} />
                    <Pie data={chartData} dataKey="value" nameKey="label" outerRadius={105} innerRadius={54} paddingAngle={2}>
                      {chartData.map((entry, index) => (
                        <Cell key={entry.label} fill={chartColors[index % chartColors.length]} />
                      ))}
                    </Pie>
                  </PieChart>
                ) : chartMode === 'line' ? (
                  <LineChart data={chartData} margin={{ left: 8, right: 18, top: 16, bottom: 8 }}>
                    <CartesianGrid stroke="#e5e7eb" vertical={false} />
                    <XAxis dataKey="label" tickLine={false} axisLine={false} minTickGap={18} />
                    <YAxis tickLine={false} axisLine={false} tickFormatter={compactNumber} width={64} />
                    <Tooltip formatter={(value) => numberFormatter.format(Number(value))} />
                    <Line type="monotone" dataKey="value" stroke="#0f766e" strokeWidth={3} dot={{ r: 3 }} activeDot={{ r: 5 }} />
                  </LineChart>
                ) : (
                  <BarChart data={chartData} margin={{ left: 8, right: 18, top: 16, bottom: 8 }}>
                    <CartesianGrid stroke="#e5e7eb" vertical={false} />
                    <XAxis dataKey="label" tickLine={false} axisLine={false} minTickGap={18} />
                    <YAxis tickLine={false} axisLine={false} tickFormatter={compactNumber} width={64} />
                    <Tooltip formatter={(value) => numberFormatter.format(Number(value))} />
                    <Bar dataKey="value" radius={[6, 6, 0, 0]} fill="#8d1b3d" />
                  </BarChart>
                )}
              </ResponsiveContainer>
            )}
          </div>
        </section>

        <section className="panel">
          <div className="panel-heading table-heading">
            <div>
              <h2>Data</h2>
              <span>
                {pageStart}-{pageEnd} af {compactNumber(totalRows)}
              </span>
            </div>
            <div className="table-actions">
              <label>
                Sortér
                <select value={orderColumn} onChange={(event) => setOrderColumn(event.target.value)}>
                  <option value="">Standard</option>
                  {columns.map((column) => (
                    <option key={column.name} value={column.name}>
                      {column.name}
                    </option>
                  ))}
                </select>
              </label>
              <select value={orderDirection} onChange={(event) => setOrderDirection(event.target.value as 'asc' | 'desc')} disabled={!orderColumn}>
                <option value="asc">Stigende</option>
                <option value="desc">Faldende</option>
              </select>
              <select value={limit} onChange={(event) => setLimit(Number(event.target.value))}>
                {limitOptions.map((item) => (
                  <option key={item} value={item}>
                    {item} rækker
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="column-picker" aria-label="Kolonner">
            {columns.map((column) => (
              <label key={column.name} className={selectedColumns.includes(column.name) ? 'checked' : ''}>
                <input type="checkbox" checked={selectedColumns.includes(column.name)} onChange={() => toggleColumn(column.name)} />
                {column.name}
              </label>
            ))}
          </div>

          <div className="data-table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  {selectedColumns.map((column) => (
                    <th key={column}>{column}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row, rowIndex) => (
                  <tr key={`${offset}-${rowIndex}`}>
                    {selectedColumns.map((column) => (
                      <td key={column}>{formatCell(row[column])}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
            {loadingRows && (
              <div className="table-loading">
                <Loader2 className="spin" aria-hidden="true" />
              </div>
            )}
          </div>

          {rows.length === 0 && !loadingRows && <div className="empty-table">Ingen rækker matcher</div>}

          <div className="pagination">
            <button className="button secondary" type="button" onClick={() => void runQuery(Math.max(0, offset - limit))} disabled={!canPageBack || loadingRows}>
              <ChevronLeft size={16} aria-hidden="true" />
              Forrige
            </button>
            <button className="button secondary" type="button" onClick={() => void runQuery(offset + limit)} disabled={!canPageForward || loadingRows}>
              Næste
              <ChevronRight size={16} aria-hidden="true" />
            </button>
          </div>
        </section>
      </>
    )
  })()

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">NP</div>
          <div>
            <strong>Nordpension</strong>
            <span>MCP connector</span>
          </div>
        </div>

        <label className="field-label">
          <Database size={16} aria-hidden="true" />
          Schema
          <select value={selectedSchema} onChange={(event) => handleSchemaChange(event.target.value)} disabled={!schemaNames.length}>
            {schemaNames.map((schema) => (
              <option key={schema} value={schema}>
                {schemaLabel(schema)}
              </option>
            ))}
          </select>
        </label>

        <nav className="table-nav" aria-label="Tabeller">
          {tableNames.map((table) => {
            const tableModel = selectedSchemaModel?.tables[table]
            return (
              <button key={table} className={table === selectedTable ? 'active' : ''} type="button" onClick={() => setSelectedTable(table)}>
                <Table2 size={16} aria-hidden="true" />
                <span>{table}</span>
                <small>{compactNumber(tableModel?.row_count_estimate ?? 0)}</small>
              </button>
            )
          })}
        </nav>

        <div className="governance">
          <ShieldCheck size={18} aria-hidden="true" />
          <div>
            <strong>Governance</strong>
            <span>PII og sensitive fritekstfelter filtreres i MCP-laget før data vises.</span>
          </div>
        </div>

        {filteredColumns.length > 0 && (
          <div className="hidden-columns">
            <strong>Skjulte felter</strong>
            <div>
              {filteredColumns.map((column) => (
                <span key={column.name}>{column.name}</span>
              ))}
            </div>
          </div>
        )}
      </aside>

      <main className="workspace">{mainContent}</main>
    </div>
  )
}

export default App
