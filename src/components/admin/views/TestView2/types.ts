export type LoanSummaryRow = {
  CLIENTE: number
  SUBCODIGO: string
  DOMICILIO: string
  COMPROBANTE: number
  ESTADO: string
  CANTIDAD: number
  FECHA: string
  fechaSortKey: number
}

export type LoanMovementRow = {
  id: string
  fechaRemito: string
  fechaSortKey: number
  numeroRemito: string
  prefijoRemito: string
  tipoComprobante: string
  nroOrden: string
  itemCode: number
  itemLabel: string
  cantidad: number
  infoExtra: string
  nuevoStock: number
  cantidadDisplay?: string
}
