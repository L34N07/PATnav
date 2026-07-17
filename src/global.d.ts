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

export interface IngresarHojaDeRutaPayload {
  motivo: string
  detalle: string
  recorrido: string
  fechaRecorrido: string
}

export interface HojaDeRutaPdfPayload {
  diaRecorrido: string
}

export interface EditarRegistroHojaDeRutaPayload {
  motivo: string
  detalle: string
  nuevoDetalle: string
  recorrido: string
  fechasRecorrido: string
}

export interface PdfPreviewResult {
  base64?: string
  error?: string
  details?: string
}

export interface PrintResult {
  status?: string
  error?: string
  details?: string
}

export interface SavePdfPayload {
  base64: string
  suggestedFileName?: string
}

export interface SavePdfResult {
  status?: string
  filePath?: string
  error?: string
  details?: string
}

export interface OpenPdfResult {
  status?: string
  filePath?: string
  error?: string
  details?: string
}

export interface ActualizarInfoextraPayload {
  numeroRemito: string | number
  prefijoRemito: string | number
  tipoComprobante: string
  nroOrden: string | number
  infoExtra: string
}

export interface ActualizarNuevoStockPayload {
  tipoComprobante: string
  prefijoRemito: string | number
  numeroRemito: string | number
  nroOrden: string | number
  nuevoStock: number
}

export interface InsertarMensajesLotePorLotePayload {
  nroLote: number
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
  processed: boolean
}

export interface UploadImagesResult {
  files?: UploadImageEntry[]
  error?: string
  details?: string
}

export type OcrAccountMatch = {
  type: "CVU" | "CBU" | null
  number: string
  holder?: string | null
}

export interface OcrFieldResult {
  type?: "CVU" | "CBU" | null
  value?: string | null
  display?: string | null
  formatted?: string | null
  confidence?: number | null
  validation?: string
  source?: string
  source_attempt?: string
}

export interface AnalyzeUploadImageResult {
  ok?: boolean
  scanner?: string
  match?: OcrAccountMatch | null
  text?: string
  amount?: string | null
  created?: string | null
  fields?: {
    payer_name: OcrFieldResult
    account: OcrFieldResult
    amount: OcrFieldResult
    payment_date: OcrFieldResult
  }
  missing_fields?: string[]
  warnings?: Array<{ code: string; message: string }>
  ocr?: {
    engine?: string
    version?: string | null
    language?: string
    average_confidence?: number | null
    selected_attempt?: string | null
  }
  error?: string
  details?: string
}

export interface StoredTransferResult {
  id_transferencia: number
  cvu_cbu: string
  monto: string
  fecha: string
  fecha_display?: string
  nombre_asociado?: string | null
  id_usuario_transferencia: number
  cod_cliente?: number | null
  nro_lugar_entrega?: number | null
  orden?: number | null
}

export interface ProcessUploadImageResult {
  status?: "stored" | "duplicate"
  analysis?: AnalyzeUploadImageResult
  duplicate?: StoredTransferResult
  duplicates?: StoredTransferResult[]
  transfer?: StoredTransferResult
  error?: string
  details?: string
  missing_fields?: string[]
}

export interface MarkUploadProcessedResult {
  status?: "processed" | "already_processed"
  file_path?: string
  file_name?: string
  error?: string
  details?: string
}

export type TransferTableName = "transferencias" | "usuarios_transferencia"

export interface TransferTableResult {
  table?: TransferTableName
  label?: string
  primary_key?: string
  columns?: string[]
  rows?: Array<Record<string, unknown>>
  error?: string
  details?: string
}

export interface DeleteTransferTableRowResult {
  status?: "deleted" | "not_deleted"
  deleted?: number
  error?: string
  details?: string
}

export interface UnidentifiedTransferenciaResult {
  id_transferencia: number
  cvu_cbu: string
  monto: string
  fecha: string
  fecha_display?: string
  nombre_asociado?: string | null
  id_usuario_transferencia: number
  transferencias_mismo_cvu?: number
  cod_cliente?: number | null
  nro_lugar_entrega?: number | null
  orden?: number | null
  razon_social?: string | null
  direccion?: string | null
}

export interface UnidentifiedTransferenciasResult {
  columns?: string[]
  rows?: UnidentifiedTransferenciaResult[]
  error?: string
  details?: string
}

export interface TransferAddressCandidate {
  cod_cliente: number
  nro_lugar_entrega: number
  razon_social?: string | null
  domicilio_fiscal?: string | null
  calle?: string | null
  numeropuerta?: number | null
  observ_domicilio?: string | null
  observ_domicilio_2?: string | null
  municipio?: string | null
  direccion?: string | null
}

export interface TransferAddressCandidatesResult {
  columns?: string[]
  rows?: TransferAddressCandidate[]
  error?: string
  details?: string
}

export interface AssignTransferenciaAccountPayload {
  cvuCbu: string
  codCliente: number | string
  nroLugarEntrega: number | string
}

export interface AssignTransferenciaAccountResult {
  status?: "assigned"
  updated_transferencias?: number
  created_usuario_transferencia?: boolean
  owner?: {
    id_usuario_transferencia: number
    cod_cliente: number
    nro_lugar_entrega: number
    orden: number
  }
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
  traer_facturas_atrasadas: () => Promise<PythonResult>
  traer_ignorar: () => Promise<PythonResult>
  traer_movimientos_cliente: (
    codCliente: number | string,
    subcodigo?: string | number
  ) => Promise<PythonResult>
  actualizar_infoextra_por_registro: (
    payload: ActualizarInfoextraPayload
  ) => Promise<PythonResult>
  actualizar_nuevo_stock: (
    payload: ActualizarNuevoStockPayload
  ) => Promise<PythonResult>
  updateUserPermissions: (
    payload: UpdateUserPermissionsPayload
  ) => Promise<PythonResult>
  insertarEnvasesEnHojaDeRuta: () => Promise<PythonResult>
  insertarMensajesLotePorLote: (
    payload: InsertarMensajesLotePorLotePayload
  ) => Promise<PythonResult>
  ingresarRegistroHojaDeRuta: (payload: IngresarHojaDeRutaPayload) => Promise<PythonResult>
  editarRegistroHojaDeRuta: (payload: EditarRegistroHojaDeRutaPayload) => Promise<PythonResult>
  traer_hoja_de_ruta: () => Promise<PythonResult>
  previewHojaDeRutaPdf: (payload: HojaDeRutaPdfPayload) => Promise<PdfPreviewResult>
  printHojaDeRutaPdf: (payload: HojaDeRutaPdfPayload) => Promise<PrintResult>
  savePdf: (payload: SavePdfPayload) => Promise<SavePdfResult>
  openPdf: (payload: SavePdfPayload) => Promise<OpenPdfResult>
  listUploadImages: () => Promise<UploadImagesResult>
  analyzeUploadImage: (filePath: string) => Promise<AnalyzeUploadImageResult>
  processUploadImage: (
    filePath: string,
    allowDuplicate?: boolean
  ) => Promise<ProcessUploadImageResult>
  markUploadProcessed: (filePath: string) => Promise<MarkUploadProcessedResult>
  listTransferTable: (tableName: TransferTableName) => Promise<TransferTableResult>
  deleteTransferTableRow: (
    tableName: TransferTableName,
    rowId: number | string
  ) => Promise<DeleteTransferTableRowResult>
  listUnidentifiedTransferencias: () => Promise<UnidentifiedTransferenciasResult>
  listIdentifiedTransferencias: () => Promise<UnidentifiedTransferenciasResult>
  listTransferAddressCandidates: () => Promise<TransferAddressCandidatesResult>
  assignTransferenciaAccount: (
    payload: AssignTransferenciaAccountPayload
  ) => Promise<AssignTransferenciaAccountResult>
}

declare global {
  interface Window {
    electronAPI: ElectronAPI
  }
}
export {}
