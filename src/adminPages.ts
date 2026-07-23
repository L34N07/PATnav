import type { ComponentType } from 'react'
import type { HomeShellComponentProps } from './components/HomeShell'
import TestView from './components/admin/views/TestView'
import TestView2 from './components/admin/views/TestView2'
import FacturasAtrasadasView from './components/admin/views/FacturasAtrasadasView'
import HojaDeRutaView from './components/admin/views/HojaDeRutaView'
import ComprobantesView from './components/admin/views/ComprobantesView'
import TransferenciasView from './components/admin/views/TransferenciasView'
import FacultadView from './components/admin/views/FacultadView'

export type AdminPageId =
  | 'test'
  | 'test2'
  | 'transfer'
  | 'comprobantes'
  | 'transferTables'
  | 'transferencias'
  | 'hojaRuta'

export type AdminPageDefinition = {
  id: AdminPageId
  label: string
  permissionKey: string
  component: ComponentType<HomeShellComponentProps>
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
    id: 'comprobantes',
    label: 'Comprobantes',
    permissionKey: 'View5',
    component: ComprobantesView
  },
  {
    id: 'transferencias',
    label: 'Transferencias',
    permissionKey: 'View7',
    component: TransferenciasView
  },
  {
    id: 'transferTables',
    label: 'Facultad',
    permissionKey: 'View6',
    component: FacultadView
  },
  {
    id: 'hojaRuta',
    label: 'Hoja de Ruta',
    permissionKey: 'View4',
    component: HojaDeRutaView
  }
]
