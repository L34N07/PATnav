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
  traer_movimientos_cliente: (codCliente, subcodigo = "") =>
    ipcRenderer.invoke('python:traer_movimientos_cliente', { codCliente, subcodigo }),
  actualizar_infoextra_por_registro: payload =>
    ipcRenderer.invoke('python:actualizar_infoextra_por_registro', payload),
  actualizar_nuevo_stock: payload =>
    ipcRenderer.invoke('python:actualizar_nuevo_stock', payload),
  updateUserPermissions: payload => ipcRenderer.invoke('python:update_user_permissions', payload),
  insertarEnvasesEnHojaDeRuta: () => ipcRenderer.invoke('python:insertar_envases_en_hoja_de_ruta'),
  ingresarRegistroHojaDeRuta: payload =>
    ipcRenderer.invoke('python:ingresar_registro_hoja_de_ruta', payload),
  traer_hoja_de_ruta: () => ipcRenderer.invoke('python:traer_hoja_de_ruta'),
  previewHojaDeRutaPdf: payload => ipcRenderer.invoke('pdf:preview_hoja_de_ruta', payload),
  printHojaDeRutaPdf: payload => ipcRenderer.invoke('pdf:print_hoja_de_ruta', payload),
  savePdf: payload => ipcRenderer.invoke('pdf:save_pdf', payload),
  openPdf: payload => ipcRenderer.invoke('pdf:open_pdf', payload),
  listUploadImages: () => ipcRenderer.invoke('uploads:list_images'),
  analyzeUploadImage: filePath => ipcRenderer.invoke('python:analyze_upload_image', { filePath })
})

contextBridge.exposeInMainWorld('electronAPI', electronAPI)
