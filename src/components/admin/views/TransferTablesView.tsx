import React, { useCallback, useEffect, useMemo, useRef, useState } from "react"
import type {
  AddUsuarioTransferenciaPayload,
  AddUsuarioTransferenciaResult,
  DeleteTransferTableRowResult,
  TransferTableName,
  TransferTableResult
} from "../../../global"
import StatusToasts from "../../StatusToasts"
import { useAutoDismissMessage } from "../../../hooks/useAutoDismissMessage"

type TransferTableDefinition = {
  id: TransferTableName
  label: string
  primaryKey: string
}

type PendingDelete = {
  row: Record<string, unknown>
  rowId: string | number
}

type AddUsuarioForm = {
  codCliente: string
  nroLugarEntrega: string
  cvuCbu: string
  orden: string
}

const TABLES: TransferTableDefinition[] = [
  {
    id: "transferencias",
    label: "Transferencias",
    primaryKey: "id_transferencia"
  },
  {
    id: "usuarios_transferencia",
    label: "Usuarios Transferencia",
    primaryKey: "id_usuario_transferencia"
  }
]

const STATUS_DURATION_MS = 4000

const toDisplayValue = (value: unknown) => {
  if (value === null || value === undefined) {
    return ""
  }

  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}T/.test(value)) {
    return value.replace("T", " ")
  }

  return String(value)
}

const isPlaceholderUserRow = (row: Record<string, unknown> | null) =>
  row != null &&
  row.cod_cliente == null &&
  row.nro_lugar_entrega == null &&
  row.cvu_cbu == null &&
  Number(row.orden) === 0

const hasAssociatedTransfers = (row: Record<string, unknown> | null) =>
  row != null && Number(row.transferencias_asociadas ?? 0) > 0

export default function TransferTablesView() {
  const electronAPI = window.electronAPI
  const loadRequestIdRef = useRef(0)
  const [activeTable, setActiveTable] = useState<TransferTableName>("transferencias")
  const [columns, setColumns] = useState<string[]>([])
  const [rows, setRows] = useState<Array<Record<string, unknown>>>([])
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)
  const [isAdding, setIsAdding] = useState(false)
  const [pendingDelete, setPendingDelete] = useState<PendingDelete | null>(null)
  const [addForm, setAddForm] = useState<AddUsuarioForm>({
    codCliente: "",
    nroLugarEntrega: "",
    cvuCbu: "",
    orden: ""
  })
  const [statusMessage, setStatusMessage] = useState<string | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  useAutoDismissMessage(statusMessage, setStatusMessage, STATUS_DURATION_MS)
  useAutoDismissMessage(errorMessage, setErrorMessage, STATUS_DURATION_MS)

  const tableDefinition = useMemo(
    () => TABLES.find(table => table.id === activeTable) ?? TABLES[0],
    [activeTable]
  )

  const selectedRow = selectedIndex == null ? null : rows[selectedIndex] ?? null
  const selectedId = selectedRow?.[tableDefinition.primaryKey]
  const deleteDisabledReason = useMemo(() => {
    if (!selectedRow) {
      return "Seleccione una fila."
    }

    if (activeTable === "usuarios_transferencia" && isPlaceholderUserRow(selectedRow)) {
      return "El usuario sin identificar no se puede eliminar."
    }

    if (activeTable === "usuarios_transferencia" && hasAssociatedTransfers(selectedRow)) {
      return "Elimine primero las transferencias asociadas."
    }

    return null
  }, [activeTable, selectedRow])

  const loadTable = useCallback(async (tableName: TransferTableName = activeTable) => {
    if (!electronAPI?.listTransferTable) {
      setErrorMessage("No se encuentra disponible la lectura de tablas.")
      return
    }

    const requestId = loadRequestIdRef.current + 1
    loadRequestIdRef.current = requestId
    setIsLoading(true)
    setErrorMessage(null)
    setColumns([])
    setRows([])
    setSelectedIndex(null)

    try {
      const result: TransferTableResult = await electronAPI.listTransferTable(tableName)
      if (requestId !== loadRequestIdRef.current) {
        return
      }

      if (result.error) {
        throw new Error(result.details || result.error)
      }

      if (result.table && result.table !== tableName) {
        throw new Error("La respuesta de la tabla no coincide con la tabla solicitada.")
      }

      setColumns(result.columns ?? [])
      setRows(result.rows ?? [])
      setSelectedIndex(null)
      setStatusMessage(`${result.rows?.length ?? 0} fila${result.rows?.length === 1 ? "" : "s"} cargada${result.rows?.length === 1 ? "" : "s"}.`)
    } catch (error) {
      if (requestId !== loadRequestIdRef.current) {
        return
      }
      console.error("No se pudo cargar la tabla de transferencias:", error)
      setColumns([])
      setRows([])
      setSelectedIndex(null)
      setErrorMessage(
        error instanceof Error ? error.message : "Error desconocido al cargar la tabla."
      )
    } finally {
      if (requestId === loadRequestIdRef.current) {
        setIsLoading(false)
      }
    }
  }, [activeTable, electronAPI])

  useEffect(() => {
    void loadTable()
  }, [loadTable])

  const handleTableChange = useCallback((tableName: TransferTableName) => {
    if (tableName === activeTable) {
      return
    }
    loadRequestIdRef.current += 1
    setActiveTable(tableName)
    setColumns([])
    setRows([])
    setSelectedIndex(null)
    setPendingDelete(null)
    setAddForm({
      codCliente: "",
      nroLugarEntrega: "",
      cvuCbu: "",
      orden: ""
    })
    setStatusMessage(null)
    setErrorMessage(null)
  }, [activeTable])

  const handleAddFormChange = useCallback((field: keyof AddUsuarioForm, value: string) => {
    setAddForm(prev => ({
      ...prev,
      [field]: field === "cvuCbu" ? value.replace(/\D/g, "").slice(0, 22) : value.replace(/\D/g, "")
    }))
  }, [])

  const handleAddUsuarioTransferencia = useCallback(async () => {
    if (activeTable !== "usuarios_transferencia") {
      return
    }

    if (!electronAPI?.addUsuarioTransferencia) {
      setErrorMessage("No se encuentra disponible el alta de usuarios de transferencia.")
      return
    }

    const payload: AddUsuarioTransferenciaPayload = {
      codCliente: addForm.codCliente,
      nroLugarEntrega: addForm.nroLugarEntrega,
      cvuCbu: addForm.cvuCbu,
      orden: addForm.orden || undefined
    }

    setIsAdding(true)
    setErrorMessage(null)

    try {
      const result: AddUsuarioTransferenciaResult =
        await electronAPI.addUsuarioTransferencia(payload)
      if (result.error) {
        throw new Error(result.details || result.error)
      }

      setStatusMessage("Usuario de transferencia agregado.")
      setAddForm({
        codCliente: "",
        nroLugarEntrega: "",
        cvuCbu: "",
        orden: ""
      })
      await loadTable("usuarios_transferencia")
    } catch (error) {
      console.error("No se pudo agregar el usuario de transferencia:", error)
      setErrorMessage(
        error instanceof Error ? error.message : "Error desconocido al agregar la fila."
      )
    } finally {
      setIsAdding(false)
    }
  }, [activeTable, addForm, electronAPI, loadTable])

  const handleDeleteSelected = useCallback(async () => {
    if (!selectedRow || selectedId == null || deleteDisabledReason) {
      if (deleteDisabledReason) {
        setErrorMessage(deleteDisabledReason)
      }
      return
    }

    if (!electronAPI?.deleteTransferTableRow) {
      setErrorMessage("No se encuentra disponible la eliminacion de filas.")
      return
    }

    setPendingDelete({
      row: selectedRow,
      rowId: selectedId as string | number
    })
  }, [deleteDisabledReason, electronAPI, selectedId, selectedRow])

  const handleCancelDelete = useCallback(() => {
    if (!isDeleting) {
      setPendingDelete(null)
    }
  }, [isDeleting])

  const handleConfirmDelete = useCallback(async () => {
    if (!pendingDelete || !electronAPI?.deleteTransferTableRow) {
      return
    }

    setIsDeleting(true)
    setErrorMessage(null)

    try {
      const result: DeleteTransferTableRowResult = await electronAPI.deleteTransferTableRow(
        activeTable,
        pendingDelete.rowId
      )
      if (result.error) {
        throw new Error(result.details || result.error)
      }

      if (result.status !== "deleted") {
        throw new Error(result.details || "No se elimino ninguna fila.")
      }

      setStatusMessage("Fila eliminada.")
      setRows(prev =>
        prev.filter(row => String(row[tableDefinition.primaryKey]) !== String(pendingDelete.rowId))
      )
      setSelectedIndex(null)
      setPendingDelete(null)
      setIsDeleting(false)
      void loadTable()
    } catch (error) {
      console.error("No se pudo eliminar la fila:", error)
      setErrorMessage(
        error instanceof Error ? error.message : "Error desconocido al eliminar la fila."
      )
      setIsDeleting(false)
    }
  }, [
    activeTable,
    electronAPI,
    loadTable,
    pendingDelete,
    tableDefinition
  ])

  return (
    <>
      <StatusToasts statusMessage={statusMessage} errorMessage={errorMessage} />
      <div className="content transfer-tables-layout">
        <section className="transfer-tables-panel">
          <div className="transfer-tables-panel__header">
            <div>
              <h2 className="uploads-browser__title">Tablas de Transferencias</h2>
              <p className="transfer-tables-panel__subtitle">
                Administracion de transferencias y usuarios de transferencia.
              </p>
            </div>
	            <div className="transfer-tables-tabs" role="tablist" aria-label="Tablas">
	              {TABLES.map(table => (
	                <button
	                  key={table.id}
	                  type="button"
	                  className={`transfer-tables-tab${activeTable === table.id ? " active" : ""}`}
	                  onClick={() => handleTableChange(table.id)}
	                  disabled={isLoading || isDeleting || isAdding}
	                >
	                  {table.label}
	                </button>
	              ))}
	            </div>
          </div>

          <div className="transfer-tables-scroll">
            <table key={activeTable} className="client-table transfer-tables-table">
              <thead className="client-table__head">
                <tr>
                  {columns.map(column => (
                    <th key={column} className="client-table__header-cell">
                      <span className="client-table__header-text">{column}</span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="client-table__body">
                {rows.length > 0 ? (
                  rows.map((row, rowIndex) => (
                    <tr
                      key={`${activeTable}-${String(row[tableDefinition.primaryKey] ?? rowIndex)}`}
                      className={`client-table__row${selectedIndex === rowIndex ? " client-table__row--selected" : ""}`}
                      onClick={() => setSelectedIndex(rowIndex)}
                    >
                      {columns.map(column => (
                        <td key={column} className="client-table__cell" title={toDisplayValue(row[column])}>
                          {toDisplayValue(row[column])}
                        </td>
                      ))}
                    </tr>
                  ))
                ) : (
                  !isLoading && (
                    <tr className="client-table__empty">
                      <td className="client-table__empty-cell" colSpan={Math.max(columns.length, 1)}>
                        No hay filas para mostrar.
                      </td>
                    </tr>
                  )
                )}
              </tbody>
            </table>
            {isLoading ? <div className="table-status loading">Cargando...</div> : null}
          </div>
        </section>

        <aside className="sidebar loan-actions transfer-tables-actions">
	          <div className="loan-actions__button-group">
	            <span className="loan-actions__section-title">Tabla</span>
	            <button
	              className="fetch-button"
	              type="button"
	              onClick={() => loadTable()}
	              disabled={isLoading || isDeleting || isAdding}
	            >
	              {isLoading ? "Cargando..." : "Actualizar"}
	            </button>
	          </div>
          <div className="loan-actions__divider" aria-hidden="true" />
          <div className="loan-actions__button-group">
            <span className="loan-actions__section-title">Filas</span>
	            <div className="transfer-tables-actions__selection">
	              {selectedRow
	                ? `${tableDefinition.primaryKey}: ${toDisplayValue(selectedId)}`
	                : "Sin fila seleccionada"}
	            </div>
	            <button
	              className="fetch-button transfer-tables-actions__delete"
	              type="button"
	              onClick={handleDeleteSelected}
	              disabled={isLoading || isDeleting || isAdding || Boolean(deleteDisabledReason)}
	              title={deleteDisabledReason ?? "Eliminar fila seleccionada"}
	            >
	              {isDeleting ? "Eliminando..." : "Eliminar fila"}
	            </button>
	            {deleteDisabledReason ? (
	              <span className="transfer-tables-actions__hint">{deleteDisabledReason}</span>
	            ) : null}
	          </div>
          {activeTable === "usuarios_transferencia" ? (
            <>
              <div className="loan-actions__divider" aria-hidden="true" />
              <div className="loan-actions__button-group">
                <span className="loan-actions__section-title">Agregar Usuario</span>
                <label className="transfer-tables-add-field">
                  <span>Cliente</span>
                  <input
                    value={addForm.codCliente}
                    onChange={event => handleAddFormChange("codCliente", event.target.value)}
                    inputMode="numeric"
                    disabled={isAdding}
                  />
                </label>
                <label className="transfer-tables-add-field">
                  <span>Lugar</span>
                  <input
                    value={addForm.nroLugarEntrega}
                    onChange={event => handleAddFormChange("nroLugarEntrega", event.target.value)}
                    inputMode="numeric"
                    disabled={isAdding}
                  />
                </label>
                <label className="transfer-tables-add-field">
                  <span>CBU/CVU</span>
                  <input
                    value={addForm.cvuCbu}
                    onChange={event => handleAddFormChange("cvuCbu", event.target.value)}
                    inputMode="numeric"
                    maxLength={22}
                    disabled={isAdding}
                  />
                </label>
                <label className="transfer-tables-add-field">
                  <span>Orden</span>
                  <input
                    value={addForm.orden}
                    onChange={event => handleAddFormChange("orden", event.target.value)}
                    inputMode="numeric"
                    placeholder="Auto"
                    disabled={isAdding}
                  />
                </label>
                <button
                  className="fetch-button"
                  type="button"
                  onClick={handleAddUsuarioTransferencia}
                  disabled={
                    isAdding ||
                    !addForm.codCliente ||
                    !addForm.nroLugarEntrega ||
                    addForm.cvuCbu.length !== 22
                  }
                >
                  {isAdding ? "Agregando..." : "Agregar fila"}
                </button>
              </div>
            </>
          ) : null}
        </aside>
      </div>
      {pendingDelete ? (
        <div className="image-modal" role="alertdialog" aria-modal="true">
          <div className="image-modal__panel transfer-delete-modal">
            <div className="image-modal__header">
              <div>
                <h3 className="image-modal__title">Eliminar fila</h3>
                <p className="transfer-delete-modal__intro">
                  {tableDefinition.label}: {tableDefinition.primaryKey} = {toDisplayValue(pendingDelete.rowId)}
                </p>
              </div>
            </div>
            <div className="transfer-delete-modal__details">
              {columns.slice(0, 6).map(column => (
                <div className="ocr-result__pair" key={column}>
                  <span className="ocr-result__label">{column}</span>
                  <span className="ocr-result__value">{toDisplayValue(pendingDelete.row[column])}</span>
                </div>
              ))}
            </div>
            <div className="duplicate-transfer-modal__actions">
              <button
                className="image-modal__close action-button--neutral"
                type="button"
                onClick={handleCancelDelete}
                disabled={isDeleting}
              >
                Cancelar
              </button>
              <button
                className="fetch-button transfer-tables-actions__delete"
                type="button"
                onClick={handleConfirmDelete}
                disabled={isDeleting}
              >
                {isDeleting ? "Eliminando..." : "Eliminar"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  )
}
