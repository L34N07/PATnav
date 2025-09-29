import type { ComponentType } from 'react'
import TestView from './components/admin/views/TestView'
import TestView2 from './components/admin/views/TestView2'

export type AdminPageId = 'test' | 'test2'

export type AdminPageDefinition = {
  id: AdminPageId
  label: string
  permissionKey: string
  component: ComponentType
}

export const ADMIN_PAGES: AdminPageDefinition[] = [
  { id: 'test', label: 'Clientes / Pagos', permissionKey: 'testView', component: TestView },
  { id: 'test2', label: 'Test View 2', permissionKey: 'testView2', component: TestView2 }
]
