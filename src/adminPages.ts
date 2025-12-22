import type { ComponentType } from 'react'
import TestView from './components/admin/views/TestView'
import TestView2 from './components/admin/views/TestView2'
import FacturasAtrasadasView from './components/admin/views/FacturasAtrasadasView'
import HojaDeRutaView from './components/admin/views/HojaDeRutaView'

export type AdminPageId = 'test' | 'test2' | 'transfer' | 'hojaRuta'

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
    label: 'Facturas Atrasadas',
    permissionKey: 'View3',
    component: FacturasAtrasadasView
  },
  {
    id: 'hojaRuta',
    label: 'Hoja de Ruta',
    permissionKey: 'View4',
    component: HojaDeRutaView
  }
]
