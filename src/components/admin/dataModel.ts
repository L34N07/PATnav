export type DataRow = Record<string, unknown>

export const CLIENT_COLUMNS = [
  { key: 'cod_cliente', label: 'Codigo', width: 140 },
  { key: 'razon_social', label: 'Razon Social', width: 220 },
  { key: 'dom_fiscal1', label: 'Domicilio', width: 260 },
  { key: 'cuit', label: 'CUIT', width: 140 }
] as const

export type ClientFilterField = typeof CLIENT_COLUMNS[number]['key']

export const CLIENT_COLUMN_LABELS = CLIENT_COLUMNS.map(column => column.label)

export const CLIENT_FILTER_MAP: Record<ClientFilterField, string> = CLIENT_COLUMNS.reduce(
  (acc, column) => {
    acc[column.key as ClientFilterField] = column.label
    return acc
  },
  {} as Record<ClientFilterField, string>
)

export const CLIENT_DEFAULT_WIDTHS = CLIENT_COLUMNS.map(column => column.width)

export const toDisplayValue = (value: unknown): string => {
  if (value === null || value === undefined) {
    return ''
  }
  return typeof value === 'string' ? value : String(value)
}

export const pickRowValue = (row: DataRow, key: string): string => {
  const variants = [key, key.toUpperCase(), key.toLowerCase()]
  for (const variant of variants) {
    if (Object.prototype.hasOwnProperty.call(row, variant)) {
      return toDisplayValue(row[variant])
    }
  }
  return ''
}
