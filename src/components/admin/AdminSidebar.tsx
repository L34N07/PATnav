import React from 'react'
import { ClientFilterField } from './dataModel'

type AdminSidebarProps = {
  searchQuery: string
  onSearchChange: (value: string) => void
  filterField: ClientFilterField
  onFilterFieldChange: (field: ClientFilterField) => void
  isLoading: boolean
  onFetchClients: () => void
  onFetchIrregularidades: () => void
  columns: string[]
  codCliente: string
  razonSocial: string
  onRazonSocialChange: (value: string) => void
  domFiscal: string
  onDomFiscalChange: (value: string) => void
  cuit: string
  onCuitChange: (value: string) => void
  editEnabled: boolean
  onToggleEdit: (value: boolean) => void
  onEditClient: () => void
  canEditClient: boolean
}

export default function AdminSidebar({
  searchQuery,
  onSearchChange,
  filterField,
  onFilterFieldChange,
  isLoading,
  onFetchClients,
  onFetchIrregularidades,
  columns,
  codCliente,
  razonSocial,
  onRazonSocialChange,
  domFiscal,
  onDomFiscalChange,
  cuit,
  onCuitChange,
  editEnabled,
  onToggleEdit,
  onEditClient,
  canEditClient
}: AdminSidebarProps) {
  const placeholders = {
    codigo: columns[0] ?? 'Codigo',
    razonSocial: columns[1] ?? 'Razon Social',
    domFiscal: columns[2] ?? 'Domicilio',
    cuit: columns[3] ?? 'CUIT'
  }

  return (
    <div className="sidebar">
      <input
        className="search-input"
        type="text"
        value={searchQuery}
        onChange={event => onSearchChange(event.target.value)}
        placeholder="Buscar"
      />
      <select
        value={filterField}
        onChange={event => onFilterFieldChange(event.target.value as ClientFilterField)}
        className="filter-select"
      >
        <option value="cod_cliente">Codigo</option>
        <option value="razon_social">Razon Social</option>
        <option value="dom_fiscal1">Domicilio</option>
        <option value="cuit">CUIT</option>
      </select>
      <hr className="separator" />
      <button
        className="fetch-button"
        onClick={onFetchClients}
        disabled={isLoading}
      >
        Traer Clientes
      </button>
      <input
        className="code-input"
        type="text"
        value={codCliente}
        placeholder={placeholders.codigo}
        readOnly
      />
      <input
        className="razon-input"
        type="text"
        value={razonSocial}
        onChange={event => onRazonSocialChange(event.target.value)}
        placeholder={placeholders.razonSocial}
        readOnly={!editEnabled}
      />
      <input
        className="dom-input"
        type="text"
        value={domFiscal}
        onChange={event => onDomFiscalChange(event.target.value)}
        placeholder={placeholders.domFiscal}
        readOnly={!editEnabled}
      />
      <input
        className="cuit-input"
        type="text"
        value={cuit}
        onChange={event => onCuitChange(event.target.value)}
        placeholder={placeholders.cuit}
        readOnly={!editEnabled}
      />
      <label className="edit-toggle">
        <input
          type="checkbox"
          checked={editEnabled}
          onChange={event => onToggleEdit(event.target.checked)}
        />
        Habilitar Edicion
      </label>
      <button
        className="edit-button"
        onClick={onEditClient}
        disabled={isLoading || !editEnabled || !canEditClient}
      >
        Editar Cliente
      </button>
      <hr className="separator" />
      <button
        className="irregularidades-button"
        onClick={onFetchIrregularidades}
        disabled={isLoading}
      >
        Actualizar pagos e Irregularidades
      </button>
    </div>
  )
}
