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
  updateUserPermissions: payload => ipcRenderer.invoke('python:update_user_permissions', payload),
  listUploadImages: () => ipcRenderer.invoke('uploads:list_images')
})

contextBridge.exposeInMainWorld('electronAPI', electronAPI)
