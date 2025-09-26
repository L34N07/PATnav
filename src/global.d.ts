export interface PythonResult<Row = Record<string, unknown>> {
  columns?: string[]
  rows?: Row[]
  status?: string
  error?: string
  details?: string
}

export interface UpdateClientePayload {
  codCliente: string
  razonSocial: string
  domFiscal: string
  cuit: string
}

export interface ElectronAPI {
  getClientes: () => Promise<PythonResult>
  traerIncongruencias: () => Promise<PythonResult>
  updateCliente: (payload: UpdateClientePayload) => Promise<PythonResult>
  modificarCobrosImpagos: () => Promise<PythonResult>
}

declare global {
  interface Window {
    electronAPI: ElectronAPI
  }
}
export {}
