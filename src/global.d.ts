export interface PythonResult<Row = Record<string, unknown>> {
  columns?: string[]
  rows?: Row[]
  status?: string
  error?: string
  details?: string
}

export interface ClientOnboardingInitialData {
  proximo_codigo?: number
  ultimo_codigo?: number
  categorias?: Array<{
    codigo: string
    descripcion: string
    tipo_factura: string
  }>
  listas?: Array<{
    codigo: number
    descripcion: string
  }>
  municipios?: Array<{
    codigo: number
    nombre: string
    sigla: string
  }>
  ultimo_punto?: {
    cod_cliente: number
    nro_lugar_entrega: number
    fecha_inicio_contrato: string
  } | null
  error?: string
  details?: string
}

export interface CreateOnboardingClientPayload {
  razonSocial: string
  domFiscal1: string
  cuit: string
  tipoCliente: string | number
  tipoFactCtaCte: string | number | null
  codLista: string | number | null
  limiteCredito: string | number | null
  codCategoria: string
  tipoCobro: string
  limiteFacturacion: string | number | null
}

export interface CreateOnboardingClientResult {
  cod_cliente?: number
  razon_social?: string
  tipo_cliente?: number
  tipo_fact_ctacte?: number | null
  cod_lista?: number | null
  cod_categoria?: string
  error?: string
  details?: string
}

export interface ClientOnboardingDeliveryContext {
  cod_cliente?: number
  razon_social?: string
  proximo_lugar?: number
  error?: string
  details?: string
}

export interface ClientOnboardingStreet {
  codigo: number
  nombre: string
}

export interface CreateOnboardingDeliveryPayload {
  codCliente: string | number
  codMunicipio: string | number
  codCalle: string | number
  numeroPuerta: string | number
  observDomicilio?: string
  fechaInicioContrato: string
  codLista: string | number
  cantOptEnvases: string | number
  esLugarCobro: string
  telefonos?: string
  frecuenciaVisita: string | number
  email?: string
  minfExtra: string
}

export interface CreateOnboardingDeliveryResult {
  cod_cliente?: number
  nro_lugar_entrega?: number
  dia_facturacion_abono?: number
  fecha_inicio_contrato?: string
  error?: string
  details?: string
}

export interface ClientOnboardingRouteReference {
  cod_cliente: number
  nro_lugar_entrega: number
  razon_social: string
  direccion: string
}

export interface ClientOnboardingRouteOption {
  cod_ruta: string
  ruta_descripcion: string
  orden_circuito: number
  l_entrega?: string
  l_cobro?: string
}

export interface OnboardingRoutePayload {
  codRuta: string
  referenciaCliente: number | string
  referenciaPunto: number | string
  referenciaOrden: number | string
  codCliente: number | string
  nroLugarEntrega: number | string
  lEntrega: string
  lCobro: string
}

export interface OnboardingRoutePreview {
  cod_ruta?: string
  posicion_referencia?: number
  orden_referencia_normalizado?: number
  orden_nuevo?: number
  clientes_a_espaciar?: number
  error?: string
  details?: string
}

export interface OnboardingRouteResult {
  cod_ruta?: string
  orden_circuito?: number
  cod_cliente?: number
  nro_lugar_entrega?: number
  l_entrega?: string
  l_cobro?: string
  clientes_espaciados?: number
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

export interface FacultadFacturasPayload {
  desde: number | string
  hasta: number | string
}

export interface FacultadFacturaItem {
  tipo_comprobante?: string
  prefijo?: number
  numero?: number
  nro_orden?: number | null
  cantidad?: string | number | null
  cod_item?: string | number | null
  precio?: string | number | null
  importe?: string | number | null
  denominacion?: string | null
}

export interface FacultadFactura {
  tipo_comprobante?: string
  prefijo?: number
  numero?: number
  cod_cliente?: string | number | null
  fecha_operacion?: string | null
  remitos_facturados?: string | null
  cae?: string | number | null
  fecha_vencimiento_cae?: string | null
  razon_social?: string | null
  dom_fiscal1?: string | null
  cod_categoria?: string | number | null
  cuit?: string | null
  categoria?: string | null
  items?: FacultadFacturaItem[]
}

export interface FacultadFacturasResult {
  columns?: string[]
  rows?: FacultadFactura[]
  desde?: number
  hasta?: number
  tipo_comprobante?: "FB" | string
  prefijo?: number
  error?: string
  details?: string
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

export interface SavePdfToDirectoryPayload extends SavePdfPayload {
  directoryPath: string
}

export interface SaveFacultadFacturasPdfsPayload {
  invoices: FacultadFactura[]
  directoryPath: string
}

export interface SavePdfResult {
  status?: string
  filePath?: string
  filePaths?: string[]
  saved?: number
  error?: string
  details?: string
}

export interface OpenPdfResult {
  status?: string
  filePath?: string
  error?: string
  details?: string
}

export interface SelectDirectoryResult {
  status?: string
  directoryPath?: string
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

export interface DeleteProcessedUploadImagesResult {
  deleted?: number
  files?: Array<{
    fileName: string
    filePath: string
  }>
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
  estado?: "NO-CARGADA" | "CARGADA" | string | null
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
  status?: "processed"
  file_path?: string
  file_name?: string
  deleted?: boolean
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

export interface AddUsuarioTransferenciaPayload {
  codCliente: number | string
  nroLugarEntrega: number | string
  cvuCbu: string
  orden?: number | string
}

export interface AddUsuarioTransferenciaResult {
  status?: "inserted"
  row?: Record<string, unknown>
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
  estado?: "NO-CARGADA" | "CARGADA" | string | null
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

export interface TransferVentaResult {
  tipo_comprobante: string
  prefijo: string | number
  numero: string | number
  fecha_vencimiento: string
  mcampo_control?: string | null
  cod_cliente: string | number
  nro_lugar_entrega: string | number
  cliente: string
  monto: string
  importe_aplicado?: string
  deuda?: string
}

export interface TransferVentaAddressResult {
  cod_cliente: string | number
  nro_lugar_entrega: string | number
  cliente: string
  tipo_lugar?: string | null
  direccion?: string | null
}

export interface TransferVentasResult {
  columns?: string[]
  rows?: TransferVentaResult[]
  address_columns?: string[]
  addresses?: TransferVentaAddressResult[]
  error?: string
  details?: string
}

export interface ListTransferVentasPayload {
  codCliente: number | string
  nroLugarEntrega: number | string
  cvuCbu?: string
}

export interface CobroComprobantePayload {
  tipoComprobante: string
  prefijo: number | string
  numero: number | string
}

export interface CobroComprobanteCheckResult {
  exists?: boolean
  count?: number
  tipo_comprobante?: string
  prefijo?: number
  numero?: number
  error?: string
  details?: string
}

export interface ApplyTransferPaymentReceiptAssignment {
  receiptComprobante: CobroComprobantePayload
  receiptClient: {
    codCliente: number | string
    nroLugarEntrega: number | string
  }
  selectedVentas: CobroComprobantePayload[]
}

export interface ApplyTransferPaymentPayload {
  transferId?: number | string
  receiptComprobante: CobroComprobantePayload
  receiptClient: {
    codCliente: number | string
    nroLugarEntrega: number | string
  }
  transferAmount: number | string
  selectedVentas: CobroComprobantePayload[]
  receiptAssignments?: ApplyTransferPaymentReceiptAssignment[]
}

export interface AppliedCobroVentaResult {
  tipo_comprobante: string
  prefijo: number
  numero: number
  importe_aplicado: string
  fully_paid: boolean
}

export interface ApplyTransferPaymentResult {
  status?: "saved"
  cobro?: {
    tipo_comprobante_cobro: string
    prefijo_recibo: number
    numero_recibo: number
    fecha_recibo?: string
    cod_cliente: number
    nro_lugar_entrega: number
  }
  cobros?: Array<{
    tipo_comprobante_cobro: string
    prefijo_recibo: number
    numero_recibo: number
    fecha_recibo?: string
    cod_cliente: number
    nro_lugar_entrega: number
  }>
  cobros_aplicados?: AppliedCobroVentaResult[]
  inserted_cobros?: number
  inserted_cobros_aplicados?: number
  updated_ventas?: number
  updated_transferencias?: number
  remaining_transfer_amount?: string
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

export interface AbonosPayload {
  environment: "produccion"
  desde: string
  hasta: string
  fechaEmision?: string
  representada?: string
  limit?: number | string
}

export interface AbonosGeneratePayload extends AbonosPayload {
  confirmation: string
  selectedCandidates?: Array<{
    codCliente: number
    nroLugarEntrega: number
  }>
}

export interface AbonosGroupSummary {
  count: number
  total: number
}

export interface AbonosPreviewCandidate {
  cliente: number
  punto: number
  razon_social?: string | null
  tipo: "FA" | "FB" | "FC" | string
  prefijo: number
  destino: "arca" | "interno" | string
  total: number
  dispensers: number
  items: number
  periodo: string
  fecha_vencimiento?: string | null
  estado?: "listo" | "descartado" | string
  motivo?: string | null
  idempotencyKey?: string
  warnings?: string[]
}

export interface AbonosPreviewSummary {
  total_candidatos: number
  FA_electronicas: AbonosGroupSummary
  FB_electronicas: AbonosGroupSummary
  FC4_internas: AbonosGroupSummary
  total_monetario_por_grupo?: Record<string, number>
  descartados: number
  duplicados_en_rango: number
  total_bruto_no_positivo: number
  listos_para_generar: number
  tipofactura_desconocida: number
  ignorados_manuales?: number
  descartados_por_motivo?: Array<{ motivo: string; cantidad: number }>
}

export interface AbonosPreviewResult {
  modo?: "PREVIEW"
  environment?: string
  escribe_db?: boolean
  llama_arca?: boolean
  confirmacion_requerida_para_generar?: string
  resumen?: AbonosPreviewSummary
  candidatos?: AbonosPreviewCandidate[]
  descartes?: Array<Record<string, unknown>>
  error?: string
  details?: string
}

export interface AbonosGenerateResult {
  modo?: "CONFIRMADO_PRODUCCION"
  environment?: string
  resumen?: Record<string, unknown>
  resultados?: Array<Record<string, unknown>>
  error?: string
  details?: string
}

export interface CuentaCorrientePayload {
  environment: "produccion"
  periodo: string
  fechaEmision: string
  representada?: string
  limit?: number | string
}

export interface CuentaCorrienteGeneratePayload extends CuentaCorrientePayload {
  confirmation: string
  selectedCandidates: Array<{ codCliente: number; nroLugarEntrega: number }>
}

export interface CuentaCorrientePreviewCandidate {
  cliente: number
  punto: number
  razon_social?: string | null
  tipo: "FA" | "FB" | "REVISAR" | string
  prefijo: number | null
  periodo: string
  facturacionCompartida?: boolean
  puntosOrigen?: number
  remitos: number
  contenidos20: number
  contenidos10: number
  consumoTotal: number
  consumoBajo: boolean
  alquileres: number
  total: number
  estado: "listo" | "revisar" | string
  warnings: string[]
}

export interface CuentaCorrientePreviewResult {
  modo?: "PREVIEW"
  environment?: string
  escribe_db?: boolean
  llama_arca?: boolean
  minimoConsumo?: number
  resumen?: {
    total: number
    listos: number
    consumo_bajo: number
    revisar: number
    FA: { count: number; total: number }
    FB: { count: number; total: number }
  }
  candidatos?: CuentaCorrientePreviewCandidate[]
  error?: string
  details?: string
}

export interface CuentaCorrienteGenerateResult {
  modo?: "CONFIRMADO_PRODUCCION"
  environment?: string
  summary?: Record<string, unknown>
  results?: Array<Record<string, unknown>>
  error?: string
  details?: string
}

export interface MovimientosApiResult<T = unknown> {
  environment?: string
  db?: Record<string, unknown>
  result?: T
  error?: string
  details?: string
}

export interface MovimientosLocation {
  cod_cliente: number
  nro_lugar_entrega: number
  razon_social?: string | null
  direccion?: string | null
  label?: string | null
  cuit?: string | number | null
  cod_categoria?: string | null
  tipofactura?: string | null
  categoria_iva?: string | null
}

export interface MovimientosItem {
  cod_item: number
  denominacion?: string | null
  denom_corto?: string | null
  precio?: number | string | null
  tasa_iva?: number | string | null
  litros_abonados?: number | string | null
}

export interface MovimientosAccountState {
  cliente?: MovimientosLocation
  ventas?: Array<Record<string, unknown>>
  movimientos?: Array<Record<string, unknown>>
  cobros?: Array<Record<string, unknown>>
}

export interface MovimientosPayload {
  environment?: "produccion" | string
  mode?: string
  codCliente?: number | string
  nroLugarEntrega?: number | string
  fecha?: string
  fechaMovimiento?: string
  fechaReferencia?: string
  tipoComprobante?: string
  prefijo?: number | string
  numero?: number | string
  numeroCi?: number | string
  numeroRecibo?: number | string
  importe?: number | string
  venta?: Record<string, unknown>
  items?: Array<Record<string, unknown>>
  movItems?: Array<Record<string, unknown>>
  confirmation?: string
  representada?: string
}

export interface DispensersPayload {
  environment?: "produccion" | string
  mode?: "instalacion" | "retiro" | "cambio" | string
  codCliente?: number | string
  nroLugarEntrega?: number | string
  codDispenserInstalado?: number | string
  codDispenserRetirado?: number | string
  codAbono?: number | string
  ubicacion?: string
}

export interface ElectronAPI {
  getClientes: () => Promise<PythonResult>
  clientOnboardingInitialData: () => Promise<ClientOnboardingInitialData>
  createOnboardingClient: (payload: CreateOnboardingClientPayload) => Promise<CreateOnboardingClientResult>
  clientOnboardingDeliveryContext: (payload: { codCliente: string | number }) => Promise<ClientOnboardingDeliveryContext>
  clientOnboardingBillingClientContext: (payload: { codCliente: string | number }) => Promise<Record<string, unknown> | { error: string; details?: string } | null>
  clientOnboardingSearchStreets: (payload: { codMunicipio: string | number; query: string }) => Promise<ClientOnboardingStreet[] | { error: string; details?: string }>
  createOnboardingDelivery: (payload: CreateOnboardingDeliveryPayload) => Promise<CreateOnboardingDeliveryResult>
  clientOnboardingSearchRouteReferences: (payload: { query: string }) => Promise<ClientOnboardingRouteReference[] | { error: string; details?: string }>
  clientOnboardingReferenceRoutes: (payload: { codCliente: string | number; nroLugarEntrega: string | number }) => Promise<ClientOnboardingRouteOption[] | { error: string; details?: string }>
  clientOnboardingPreviewRoute: (payload: OnboardingRoutePayload) => Promise<OnboardingRoutePreview>
  createOnboardingRoute: (payload: OnboardingRoutePayload) => Promise<OnboardingRouteResult>
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
  listFacultadFacturas: (
    payload: FacultadFacturasPayload
  ) => Promise<FacultadFacturasResult>
  previewFacultadFacturasPdf: (
    payload: FacultadFacturasPayload
  ) => Promise<PdfPreviewResult & FacultadFacturasResult>
  printHojaDeRutaPdf: (payload: HojaDeRutaPdfPayload) => Promise<PrintResult>
  selectDirectory: () => Promise<SelectDirectoryResult>
  saveFacultadFacturasPdfs: (payload: SaveFacultadFacturasPdfsPayload) => Promise<SavePdfResult>
  savePdfToDirectory: (payload: SavePdfToDirectoryPayload) => Promise<SavePdfResult>
  savePdf: (payload: SavePdfPayload) => Promise<SavePdfResult>
  openPdf: (payload: SavePdfPayload) => Promise<OpenPdfResult>
  listUploadImages: () => Promise<UploadImagesResult>
  deleteProcessedUploadImages: () => Promise<DeleteProcessedUploadImagesResult>
  analyzeUploadImage: (filePath: string) => Promise<AnalyzeUploadImageResult>
  processUploadImage: (
    filePath: string,
    allowDuplicate?: boolean,
    analysis?: AnalyzeUploadImageResult
  ) => Promise<ProcessUploadImageResult>
  markUploadProcessed: (filePath: string) => Promise<MarkUploadProcessedResult>
  listTransferTable: (tableName: TransferTableName) => Promise<TransferTableResult>
  deleteTransferTableRow: (
    tableName: TransferTableName,
    rowId: number | string
  ) => Promise<DeleteTransferTableRowResult>
  addUsuarioTransferencia: (
    payload: AddUsuarioTransferenciaPayload
  ) => Promise<AddUsuarioTransferenciaResult>
  listUnidentifiedTransferencias: () => Promise<UnidentifiedTransferenciasResult>
  listIdentifiedTransferencias: () => Promise<UnidentifiedTransferenciasResult>
  listTransferAddressCandidates: () => Promise<TransferAddressCandidatesResult>
  listTransferVentas: (
    payload: ListTransferVentasPayload
  ) => Promise<TransferVentasResult>
  checkCobroComprobante: (
    payload: CobroComprobantePayload
  ) => Promise<CobroComprobanteCheckResult>
  applyTransferPayment: (
    payload: ApplyTransferPaymentPayload
  ) => Promise<ApplyTransferPaymentResult>
  assignTransferenciaAccount: (
    payload: AssignTransferenciaAccountPayload
  ) => Promise<AssignTransferenciaAccountResult>
  previewAbonos: (payload: AbonosPayload) => Promise<AbonosPreviewResult>
  generateAbonos: (payload: AbonosGeneratePayload) => Promise<AbonosGenerateResult>
  previewCuentaCorriente: (payload: CuentaCorrientePayload) => Promise<CuentaCorrientePreviewResult>
  generateCuentaCorriente: (payload: CuentaCorrienteGeneratePayload) => Promise<CuentaCorrienteGenerateResult>
  movimientosInitialData: (payload?: MovimientosPayload) => Promise<MovimientosApiResult>
  movimientosSearchLocations: (
    payload: { environment?: string; query?: string; limit?: number | string }
  ) => Promise<MovimientosApiResult<MovimientosLocation[]>>
  movimientosAccountState: (
    payload: MovimientosPayload
  ) => Promise<MovimientosApiResult<MovimientosAccountState>>
  movimientosVentaItems: (
    payload: { environment?: string; tipoComprobante: string; prefijo: number | string; numero: number | string }
  ) => Promise<MovimientosApiResult<Array<Record<string, unknown>>>>
  movimientosCreditInvoices: (
    payload: MovimientosPayload
  ) => Promise<MovimientosApiResult<Array<Record<string, unknown>>>>
  movimientosAvailableAbonos: (
    payload: MovimientosPayload
  ) => Promise<MovimientosApiResult<Array<Record<string, unknown>>>>
  movimientosPendingVentas: (
    payload: MovimientosPayload
  ) => Promise<MovimientosApiResult<Array<Record<string, unknown>>>>
  movimientosSuggestedNumber: (
    payload: MovimientosPayload
  ) => Promise<MovimientosApiResult<Record<string, unknown>>>
  movimientosPreview: (payload: MovimientosPayload) => Promise<MovimientosApiResult<Record<string, unknown>>>
  movimientosSave: (payload: MovimientosPayload) => Promise<MovimientosApiResult<Record<string, unknown>>>
  movimientosPreviewDelete: (
    payload: MovimientosPayload
  ) => Promise<MovimientosApiResult<Record<string, unknown>>>
  movimientosDelete: (payload: MovimientosPayload) => Promise<MovimientosApiResult<Record<string, unknown>>>
  previewFiscalBacklog: (payload: {
    environment: "produccion"
    desde: string
    hasta: string
    representada?: string
  }) => Promise<MovimientosApiResult<Record<string, unknown>>>
  authorizeFiscalBacklog: (payload: {
    environment: "produccion"
    confirmation: "AUTORIZAR_PENDIENTES_FISCALES"
    desde: string
    hasta: string
    representada?: string
  }) => Promise<MovimientosApiResult<Record<string, unknown>>>
  dispensersInitialData: (payload?: DispensersPayload) => Promise<MovimientosApiResult<Record<string, unknown>>>
  dispensersSearchLocations: (
    payload: { environment?: string; query?: string; limit?: number | string }
  ) => Promise<MovimientosApiResult<MovimientosLocation[]>>
  dispensersClientDispensers: (
    payload: DispensersPayload
  ) => Promise<MovimientosApiResult<Record<string, unknown>>>
  dispensersDispenser: (
    payload: { environment?: string; codDispenser: number | string }
  ) => Promise<MovimientosApiResult<Record<string, unknown>>>
  dispensersPreview: (payload: DispensersPayload) => Promise<MovimientosApiResult<Record<string, unknown>>>
  dispensersSave: (payload: DispensersPayload) => Promise<MovimientosApiResult<Record<string, unknown>>>
}

declare global {
  interface Window {
    electronAPI: ElectronAPI
  }
}
export {}
