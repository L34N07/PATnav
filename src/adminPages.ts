import type { ComponentType } from 'react'
import TestView from './components/admin/views/TestView'
import TestView2 from './components/admin/views/TestView2'
import CobrosTransferenciaView from './components/admin/views/CobrosTransferenciaView'

export type AdminPageId = 'test' | 'test2' | 'transfer'

export type AdminPageDefinition = {
  id: AdminPageId
  label: string
  permissionKey: string
  component: ComponentType
}

export const ADMIN_PAGES: AdminPageDefinition[] = [
  { id: 'test', label: 'Clientes / Pagos', permissionKey: 'testView', component: TestView },
  { id: 'test2', label: 'Prestamos y Devoluciones', permissionKey: 'testView2', component: TestView2 },
  {
    id: 'transfer',
    label: 'Cobros por Transferencia',
    permissionKey: 'View3',
    component: CobrosTransferenciaView
  }
]
