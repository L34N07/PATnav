const { contextBridge, ipcRenderer } = require('electron')

const electronAPI = Object.freeze({
  getClientes: () => ipcRenderer.invoke('python:get_clientes'),
  getAppUser: username => ipcRenderer.invoke('python:get_app_user', { username }),
  getAppUsers: userType => ipcRenderer.invoke('python:get_app_users', { userType }),
  traerIncongruencias: () => ipcRenderer.invoke('python:traer_incongruencias'),
  updateCliente: payload => ipcRenderer.invoke('python:update_cliente', payload),
  modificarCobrosImpagos: () => ipcRenderer.invoke('python:modificar_cobros_impagos'),
  resumen_remitos: () => ipcRenderer.invoke('python:resumen_remitos'),
  traer_resumen_prestamos: () => ipcRenderer.invoke('python:traer_resumen_prestamos'),
  traer_facturas_atrasadas: () => ipcRenderer.invoke('python:traer_facturas_atrasadas'),
  traer_ignorar: () => ipcRenderer.invoke('python:traer_ignorar'),
  traer_movimientos_cliente: (codCliente, subcodigo = "") =>
    ipcRenderer.invoke('python:traer_movimientos_cliente', { codCliente, subcodigo }),
  actualizar_infoextra_por_registro: payload =>
    ipcRenderer.invoke('python:actualizar_infoextra_por_registro', payload),
  actualizar_nuevo_stock: payload =>
    ipcRenderer.invoke('python:actualizar_nuevo_stock', payload),
  updateUserPermissions: payload => ipcRenderer.invoke('python:update_user_permissions', payload),
  insertarEnvasesEnHojaDeRuta: () => ipcRenderer.invoke('python:insertar_envases_en_hoja_de_ruta'),
  insertarMensajesLotePorLote: payload =>
    ipcRenderer.invoke('python:insertar_mensajes_lote_por_lote', payload),
  ingresarRegistroHojaDeRuta: payload =>
    ipcRenderer.invoke('python:ingresar_registro_hoja_de_ruta', payload),
  editarRegistroHojaDeRuta: payload => ipcRenderer.invoke('python:editar_registro_hdr', payload),
  traer_hoja_de_ruta: () => ipcRenderer.invoke('python:traer_hoja_de_ruta'),
  previewHojaDeRutaPdf: payload => ipcRenderer.invoke('pdf:preview_hoja_de_ruta', payload),
  listFacultadFacturas: payload => ipcRenderer.invoke('facultad:list_facturas', payload),
  previewFacultadFacturasPdf: payload =>
    ipcRenderer.invoke('pdf:preview_facultad_facturas', payload),
  printHojaDeRutaPdf: payload => ipcRenderer.invoke('pdf:print_hoja_de_ruta', payload),
  selectDirectory: () => ipcRenderer.invoke('dialog:select_directory'),
  saveFacultadFacturasPdfs: payload =>
    ipcRenderer.invoke('pdf:save_facultad_facturas_to_directory', payload),
  savePdfToDirectory: payload => ipcRenderer.invoke('pdf:save_pdf_to_directory', payload),
  savePdf: payload => ipcRenderer.invoke('pdf:save_pdf', payload),
  openPdf: payload => ipcRenderer.invoke('pdf:open_pdf', payload),
  listUploadImages: () => ipcRenderer.invoke('uploads:list_images'),
  deleteProcessedUploadImages: () => ipcRenderer.invoke('uploads:delete_processed_images'),
  analyzeUploadImage: filePath => ipcRenderer.invoke('python:analyze_upload_image', { filePath }),
  processUploadImage: (filePath, allowDuplicate = false, analysis = undefined) =>
    ipcRenderer.invoke('python:process_upload_image', { filePath, allowDuplicate, analysis }),
  markUploadProcessed: filePath =>
    ipcRenderer.invoke('python:mark_upload_processed', { filePath }),
  listTransferTable: tableName =>
    ipcRenderer.invoke('python:list_transfer_table', { tableName }),
  deleteTransferTableRow: (tableName, rowId) =>
    ipcRenderer.invoke('python:delete_transfer_table_row', { tableName, rowId }),
  addUsuarioTransferencia: payload =>
    ipcRenderer.invoke('python:add_usuario_transferencia', payload),
  listUnidentifiedTransferencias: () =>
    ipcRenderer.invoke('python:list_unidentified_transferencias'),
  listIdentifiedTransferencias: () =>
    ipcRenderer.invoke('python:list_identified_transferencias'),
  listTransferAddressCandidates: () =>
    ipcRenderer.invoke('python:list_transfer_address_candidates'),
  listTransferVentas: payload =>
    ipcRenderer.invoke('python:list_transfer_ventas', payload),
  checkCobroComprobante: payload =>
    ipcRenderer.invoke('python:check_cobro_comprobante', payload),
  applyTransferPayment: payload =>
    ipcRenderer.invoke('python:apply_transfer_payment', payload),
  assignTransferenciaAccount: payload =>
    ipcRenderer.invoke('python:assign_transferencia_account', payload)
})

contextBridge.exposeInMainWorld('electronAPI', electronAPI)
