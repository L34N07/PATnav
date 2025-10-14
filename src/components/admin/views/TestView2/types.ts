export type LoanSummaryRow = {
  CLIENTE: number
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
  itemCode: number
  itemLabel: string
  cantidad: number
  infoExtra: string
}
