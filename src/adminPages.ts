import type { ComponentType } from 'react'
import type { HomeShellComponentProps } from './components/HomeShell'
import TestView from './components/admin/views/TestView'
import TestView2 from './components/admin/views/TestView2'
import FacturasAtrasadasView from './components/admin/views/FacturasAtrasadasView'
import HojaDeRutaView from './components/admin/views/HojaDeRutaView'
import CobrosTransferenciaView from './components/admin/views/CobrosTransferenciaView'
import TransferTablesView from './components/admin/views/TransferTablesView'
import TransferIdentificationView from './components/admin/views/TransferIdentificationView'

export type AdminPageId =
  | 'test'
  | 'test2'
  | 'transfer'
  | 'cobrosTransferencia'
  | 'transferTables'
  | 'transferIdentification'
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
    id: 'cobrosTransferencia',
    label: 'Cobros por Transferencia',
    permissionKey: 'View5',
    component: CobrosTransferenciaView
  },
  {
    id: 'transferTables',
    label: 'Tablas Transferencias',
    permissionKey: 'View6',
    component: TransferTablesView
  },
  {
    id: 'transferIdentification',
    label: 'Identificar Transferencias',
    permissionKey: 'View7',
    component: TransferIdentificationView
  },
  {
    id: 'hojaRuta',
    label: 'Hoja de Ruta',
    permissionKey: 'View4',
    component: HojaDeRutaView
  }
]
