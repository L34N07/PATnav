export interface PythonResult<Row = Record<string, unknown>> {
  columns?: string[]
  rows?: Row[]
  status?: string
  error?: string
  details?: string
}

export type AppUserResult = PythonResult<Record<string, unknown>>

export interface UpdateClientePayload {
  codCliente: string
  razonSocial: string
  domFiscal: string
  cuit: string
}

export interface UpdateUserPermissionsPayload {
  userId: number
  permissions: Record<string, boolean>
}

export interface ActualizarInfoextraPayload {
  numeroRemito: string | number
  prefijoRemito: string | number
  tipoComprobante: string
  nroOrden: string | number
  infoExtra: string
}

export interface TraerMovimientosClientePayload {
  codCliente: number | string
  subcodigo: string | number
}

export interface UploadImageEntry {
  fileName: string
  filePath: string
  fileUrl: string
  dataUrl: string
  modifiedTime: number
  size: number
}

export interface UploadImagesResult {
  files?: UploadImageEntry[]
  error?: string
  details?: string
}

export type OcrAccountMatch = {
  type: "CVU" | "CBU"
  number: string
  holder?: string | null
}

export interface AnalyzeUploadImageResult {
  match?: OcrAccountMatch | null
  text?: string
  amount?: string
  error?: string
  details?: string
}

export interface ElectronAPI {
  getClientes: () => Promise<PythonResult>
  getAppUser: (username: string) => Promise<AppUserResult>
  getAppUsers: (userType?: string) => Promise<AppUserResult>
  traerIncongruencias: () => Promise<PythonResult>
  updateCliente: (payload: UpdateClientePayload) => Promise<PythonResult>
  modificarCobrosImpagos: () => Promise<PythonResult>
  resumen_remitos: () => Promise<PythonResult>
  traer_resumen_prestamos: () => Promise<PythonResult>
  traer_movimientos_cliente: (
    codCliente: number | string,
    subcodigo?: string | number
  ) => Promise<PythonResult>
  actualizar_infoextra_por_registro: (
    payload: ActualizarInfoextraPayload
  ) => Promise<PythonResult>
  updateUserPermissions: (
    payload: UpdateUserPermissionsPayload
  ) => Promise<PythonResult>
  listUploadImages: () => Promise<UploadImagesResult>
  analyzeUploadImage: (filePath: string) => Promise<AnalyzeUploadImageResult>
}

declare global {
  interface Window {
    electronAPI: ElectronAPI
  }
}
export {}
