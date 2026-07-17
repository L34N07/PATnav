import React, { useCallback, useEffect, useState } from "react"
import type { AnalyzeUploadImageResult } from "../../../global"
import { useAutoDismissMessage } from "../../../hooks/useAutoDismissMessage"
import StatusToasts from "../../StatusToasts"

type UploadImage = {
  fileName: string
  filePath: string
  fileUrl: string
  dataUrl: string
  modifiedTime: number
  size: number
  processed: boolean
}

type AnalysisMatch = {
  type: "CVU" | "CBU" | null
  number: string
  holder?: string | null
}

type AnalysisField = {
  type?: "CVU" | "CBU" | null
  value?: string | null
  display?: string | null
  formatted?: string | null
  confidence?: number | null
  validation?: string
}

type AnalysisResult = {
  match: AnalysisMatch | null
  amount?: string | null
  created?: string | null
  fields?: {
    payer_name: AnalysisField
    account: AnalysisField
    amount: AnalysisField
    payment_date: AnalysisField
  }
  missingFields?: string[]
  warnings?: Array<{ code: string; message: string }>
}

type StoredTransfer = {
  id_transferencia: number
  cvu_cbu: string
  monto: string
  fecha: string
  fecha_display?: string
  nombre_asociado?: string | null
  id_usuario_transferencia: number
  cod_cliente?: number | null
  nro_lugar_entrega?: number | null
  orden?: number | null
}

type ProcessImageResponse = {
  status?: "stored" | "duplicate"
  analysis?: AnalyzeUploadImageResult
  duplicate?: StoredTransfer
  transfer?: StoredTransfer
  error?: string
  details?: string
  missing_fields?: string[]
}

type BatchStats = {
  total: number
  stored: number
  skipped: number
  errors: string[]
}

type DuplicateReview = {
  image: UploadImage
  result: ProcessImageResponse
  remaining: UploadImage[]
  stats: BatchStats
}

const STATUS_DURATION_MS = 4000

type UploadsGridItemProps = {
  image: UploadImage
  isSelected: boolean
  onSelect: (image: UploadImage) => void
}

const UploadsGridItem = React.memo(function UploadsGridItem({
  image,
  isSelected,
  onSelect
}: UploadsGridItemProps) {
  const handleClick = useCallback(() => onSelect(image), [image, onSelect])

  return (
    <button
      type="button"
      className={`uploads-browser__item${isSelected ? " selected" : ""}${
        image.processed ? " uploads-browser__item--processed" : ""
      }`}
      onClick={handleClick}
      aria-pressed={isSelected}
    >
      <div className="uploads-browser__preview">
        <img src={image.dataUrl || image.fileUrl} alt={image.fileName} loading="lazy" />
        {image.processed ? (
          <span className="uploads-browser__processed-mark" aria-label="Procesada">
            ✓
          </span>
        ) : null}
      </div>
      <div className="uploads-browser__caption">
        <span className="uploads-browser__filename" title={image.fileName}>
          {image.fileName}
        </span>
        {image.processed ? (
          <span className="uploads-browser__processed-label">Procesada</span>
        ) : null}
      </div>
    </button>
  )
})

type ImageAnalysisModalProps = {
  image: UploadImage
  isAnalyzing: boolean
  analysisResult: AnalysisResult | null
  onClose: () => void
}

function ImageAnalysisModal({
  image,
  isAnalyzing,
  analysisResult,
  onClose
}: ImageAnalysisModalProps) {
  const fields = analysisResult?.fields
  const holder = fields?.payer_name.value ?? analysisResult?.match?.holder
  const accountType = fields?.account.type ?? analysisResult?.match?.type
  const accountNumber = fields?.account.formatted ?? analysisResult?.match?.number
  const amount = fields?.amount.display ??
    (analysisResult?.amount ? `$${analysisResult.amount}` : null)
  const paymentDate = fields?.payment_date.display ?? analysisResult?.created
  const hasDetectedFields = Boolean(
    accountNumber || paymentDate || amount || holder
  )

  return (
    <div className="image-modal" role="dialog" aria-modal="true" onClick={onClose}>
      <div className="image-modal__panel" onClick={event => event.stopPropagation()}>
        <div className="image-modal__header">
          <h3 className="image-modal__title">{image.fileName}</h3>
          <button className="image-modal__close" type="button" onClick={onClose}>
            Cerrar
          </button>
        </div>
        <div className="image-modal__body">
          <div className="image-modal__preview">
            <img src={image.dataUrl || image.fileUrl} alt={image.fileName} />
          </div>
          <div className="image-modal__sidebar">
            {isAnalyzing ? (
              <div className="ocr-status">Analizando imagen...</div>
            ) : analysisResult ? (
              hasDetectedFields ? (
                <div className="ocr-result">
                  {holder ? (
                    <div className="ocr-result__pair">
                      <span className="ocr-result__label">Titular</span>
                      <span className="ocr-result__value ocr-result__value--holder">
                        {holder}
                      </span>
                    </div>
                  ) : null}
                  {accountNumber ? (
                    <div className="ocr-result__pair">
                      <span className="ocr-result__label">{accountType ?? "CBU/CVU"}</span>
                      <span className="ocr-result__value ocr-result__value--account">
                        {accountNumber}
                      </span>
                    </div>
                  ) : null}
                  {paymentDate ? (
                    <div className="ocr-result__pair">
                      <span className="ocr-result__label">Fecha</span>
                      <span className="ocr-result__value">{paymentDate}</span>
                    </div>
                  ) : null}
                  {amount ? (
                    <div className="ocr-result__pair">
                      <span className="ocr-result__label">Monto</span>
                      <span className="ocr-result__amount">{amount}</span>
                    </div>
                  ) : null}
                  {analysisResult.warnings?.length ? (
                    <div className="ocr-result__warnings">
                      {analysisResult.warnings.map(warning => (
                        <div className="ocr-result__warning" key={warning.code}>
                          {warning.message}
                        </div>
                      ))}
                    </div>
                  ) : null}
                </div>
              ) : (
                <div className="ocr-status">
                  No se identificaron CVU, CBU, fecha o monto en la imagen analizada.
                </div>
              )
            ) : (
              <div className="ocr-status">
                Presione &quot;Analizar Imagen&quot; para extraer CVU, CBU, fecha y monto.
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

type DuplicateTransferModalProps = {
  review: DuplicateReview
  isWorking: boolean
  onStoreAnyway: () => void
  onSkip: () => void
}

function formatStoredAmount(value: string) {
  const amount = Number(value)
  return Number.isFinite(amount)
    ? new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS" }).format(amount)
    : value
}

function DuplicateTransferModal({
  review,
  isWorking,
  onStoreAnyway,
  onSkip
}: DuplicateTransferModalProps) {
  const stored = review.result.duplicate

  if (!stored) {
    return null
  }

  return (
    <div className="image-modal" role="alertdialog" aria-modal="true">
      <div className="image-modal__panel duplicate-transfer-modal">
        <div className="image-modal__header">
          <div>
            <h3 className="image-modal__title">Posible transferencia duplicada</h3>
            <p className="duplicate-transfer-modal__intro">
              Ya existe una transferencia con la misma cuenta, monto y fecha.
            </p>
          </div>
        </div>
        <div className="image-modal__body">
          <div className="image-modal__preview">
            <img
              src={review.image.dataUrl || review.image.fileUrl}
              alt={review.image.fileName}
            />
          </div>
          <div className="image-modal__sidebar duplicate-transfer-modal__details">
            <span className="ocr-result__label">Transferencia almacenada</span>
            <div className="ocr-result__pair">
              <span className="ocr-result__label">Titular detectado</span>
              <span className="ocr-result__value">{stored.nombre_asociado || "Sin nombre"}</span>
            </div>
            <div className="ocr-result__pair">
              <span className="ocr-result__label">CBU/CVU</span>
              <span className="ocr-result__value ocr-result__value--account">
                {stored.cvu_cbu}
              </span>
            </div>
            <div className="ocr-result__pair">
              <span className="ocr-result__label">Monto</span>
              <span className="ocr-result__amount">{formatStoredAmount(stored.monto)}</span>
            </div>
            <div className="ocr-result__pair">
              <span className="ocr-result__label">Fecha</span>
              <span className="ocr-result__value">
                {stored.fecha_display || stored.fecha}
              </span>
            </div>
            <div className="ocr-result__pair">
              <span className="ocr-result__label">Cliente / lugar</span>
              <span className="ocr-result__value">
                {stored.cod_cliente == null
                  ? "Sin identificar"
                  : `${stored.cod_cliente} / ${stored.nro_lugar_entrega}`}
              </span>
            </div>
          </div>
        </div>
        <div className="duplicate-transfer-modal__actions">
          <button
            className="image-modal__close action-button--skip"
            type="button"
            onClick={onSkip}
            disabled={isWorking}
          >
            Omitir y marcar procesada
          </button>
          <button
            className="fetch-button action-button--confirm"
            type="button"
            onClick={onStoreAnyway}
            disabled={isWorking}
          >
            {isWorking ? "Guardando..." : "Guardar de todos modos"}
          </button>
        </div>
      </div>
    </div>
  )
}

function mapAnalysisResult(response?: AnalyzeUploadImageResult): AnalysisResult | null {
  if (!response) {
    return null
  }
  return {
    match: response.match ?? null,
    amount: response.amount ?? null,
    created: response.created ?? null,
    fields: response.fields,
    missingFields: response.missing_fields ?? [],
    warnings: response.warnings ?? []
  }
}

export default function CobrosTransferenciaView() {
  const electronAPI = window.electronAPI

  const [images, setImages] = useState<UploadImage[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [statusMessage, setStatusMessage] = useState<string | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [selectedImage, setSelectedImage] = useState<UploadImage | null>(null)
  const [analysisImage, setAnalysisImage] = useState<UploadImage | null>(null)
  const [analysisResult, setAnalysisResult] = useState<AnalysisResult | null>(null)
  const [isAnalyzing, setIsAnalyzing] = useState(false)
  const [isProcessing, setIsProcessing] = useState(false)
  const [processingProgress, setProcessingProgress] = useState<string | null>(null)
  const [duplicateReview, setDuplicateReview] = useState<DuplicateReview | null>(null)
  const [isDuplicateActionRunning, setIsDuplicateActionRunning] = useState(false)

  useAutoDismissMessage(statusMessage, setStatusMessage, STATUS_DURATION_MS)
  useAutoDismissMessage(errorMessage, setErrorMessage, STATUS_DURATION_MS)

  const refreshImages = useCallback(async () => {
    if (!electronAPI?.listUploadImages) {
      setErrorMessage("No se encuentra disponible la accion de listar imagenes.")
      return
    }

    setIsLoading(true)
    setErrorMessage(null)

    try {
      const result = await electronAPI.listUploadImages()
      if (result?.error) {
        throw new Error(result.details || result.error)
      }

      const files = result?.files ?? []
      setImages(files)
      setSelectedImage(prev => {
        if (!prev) {
          return null
        }
        const stillExists = files.find(file => file.filePath === prev.filePath)
        return stillExists ?? null
      })

      if (files.length > 0) {
        setStatusMessage("Imagenes actualizadas.")
      } else {
        setStatusMessage(null)
      }
    } catch (error) {
      console.error("No se pudieron cargar las imagenes:", error)
      setStatusMessage(null)
      setErrorMessage(
        error instanceof Error
          ? error.message
          : "Error desconocido al leer la carpeta uploads."
      )
    } finally {
      setIsLoading(false)
    }
  }, [electronAPI])

  useEffect(() => {
    void refreshImages()
  }, [refreshImages])

  const performImageAnalysis = useCallback(
    async (image: UploadImage) => {
      if (!electronAPI?.analyzeUploadImage) {
        setErrorMessage("El analisis de imagen no se encuentra disponible.")
        return
      }

      setIsAnalyzing(true)
      setAnalysisResult(null)

      try {
        const response = await electronAPI.analyzeUploadImage(image.filePath)
        if (response?.error) {
          throw new Error(response.details || response.error)
        }

        setAnalysisResult(mapAnalysisResult(response))

        if (!response?.match && !response?.amount && !response?.created) {
          setStatusMessage("No se detectaron CVU, CBU, fecha ni monto en la imagen seleccionada.")
        }
      } catch (error) {
        console.error("No se pudo analizar la imagen:", error)
        setErrorMessage(
          error instanceof Error ? error.message : "Error desconocido durante el analisis."
        )
      } finally {
        setIsAnalyzing(false)
      }
    },
    [electronAPI, setErrorMessage, setStatusMessage]
  )

  const finishProcessingBatch = useCallback(
    async (stats: BatchStats) => {
      setDuplicateReview(null)
      setProcessingProgress(null)
      setIsProcessing(false)
      await refreshImages()

      const summary = `${stats.stored} guardada${stats.stored === 1 ? "" : "s"}, ${
        stats.skipped
      } duplicada${stats.skipped === 1 ? "" : "s"} omitida${
        stats.skipped === 1 ? "" : "s"
      }.`
      setStatusMessage(summary)
      if (stats.errors.length > 0) {
        setErrorMessage(
          `${stats.errors.length} imagen${stats.errors.length === 1 ? "" : "es"} no se pudo procesar: ${stats.errors[0]}`
        )
      }
    },
    [refreshImages]
  )

  const processImageQueue = useCallback(
    async (queue: UploadImage[], initialStats: BatchStats) => {
      if (!electronAPI?.processUploadImage) {
        setIsProcessing(false)
        setErrorMessage("La accion de procesar imagenes no se encuentra disponible.")
        return
      }

      let stats = initialStats
      for (let index = 0; index < queue.length; index += 1) {
        const image = queue[index]
        const completed = stats.stored + stats.skipped + stats.errors.length
        setProcessingProgress(`Procesando ${completed + 1} de ${stats.total}: ${image.fileName}`)

        try {
          const response = (await electronAPI.processUploadImage(
            image.filePath,
            false
          )) as ProcessImageResponse

          if (response.error) {
            stats = {
              ...stats,
              errors: [...stats.errors, `${image.fileName}: ${response.details || response.error}`]
            }
            continue
          }

          if (response.status === "duplicate" && response.duplicate) {
            setProcessingProgress(`Coincidencia encontrada: ${image.fileName}`)
            setDuplicateReview({
              image,
              result: response,
              remaining: queue.slice(index + 1),
              stats
            })
            return
          }

          if (response.status === "stored") {
            stats = { ...stats, stored: stats.stored + 1 }
          } else {
            stats = {
              ...stats,
              errors: [...stats.errors, `${image.fileName}: respuesta inesperada`]
            }
          }
        } catch (error) {
          stats = {
            ...stats,
            errors: [
              ...stats.errors,
              `${image.fileName}: ${error instanceof Error ? error.message : "error desconocido"}`
            ]
          }
        }
      }

      await finishProcessingBatch(stats)
    },
    [electronAPI, finishProcessingBatch]
  )

  const handleProcessImages = useCallback(() => {
    const pendingImages = images.filter(image => !image.processed)
    if (pendingImages.length === 0) {
      setStatusMessage("No hay imagenes pendientes de procesar.")
      return
    }

    setErrorMessage(null)
    setStatusMessage(null)
    setIsProcessing(true)
    void processImageQueue(pendingImages, {
      total: pendingImages.length,
      stored: 0,
      skipped: 0,
      errors: []
    })
  }, [images, processImageQueue])

  const handleStoreDuplicate = useCallback(async () => {
    if (!duplicateReview || !electronAPI?.processUploadImage) {
      return
    }

    setIsDuplicateActionRunning(true)
    const { image, remaining } = duplicateReview
    let stats = duplicateReview.stats
    try {
      const response = (await electronAPI.processUploadImage(
        image.filePath,
        true
      )) as ProcessImageResponse
      if (response.error || response.status !== "stored") {
        stats = {
          ...stats,
          errors: [...stats.errors, `${image.fileName}: ${response.details || response.error || "no se pudo guardar"}`]
        }
      } else {
        stats = { ...stats, stored: stats.stored + 1 }
      }
    } catch (error) {
      stats = {
        ...stats,
        errors: [
          ...stats.errors,
          `${image.fileName}: ${error instanceof Error ? error.message : "error desconocido"}`
        ]
      }
    }

    setDuplicateReview(null)
    setIsDuplicateActionRunning(false)
    await processImageQueue(remaining, stats)
  }, [duplicateReview, electronAPI, processImageQueue])

  const handleSkipDuplicate = useCallback(async () => {
    if (!duplicateReview || !electronAPI?.markUploadProcessed) {
      return
    }

    setIsDuplicateActionRunning(true)
    const { image, remaining } = duplicateReview
    let stats = duplicateReview.stats
    try {
      const response = await electronAPI.markUploadProcessed(image.filePath)
      if (response?.error) {
        stats = {
          ...stats,
          errors: [...stats.errors, `${image.fileName}: ${response.details || response.error}`]
        }
      } else {
        stats = { ...stats, skipped: stats.skipped + 1 }
      }
    } catch (error) {
      stats = {
        ...stats,
        errors: [
          ...stats.errors,
          `${image.fileName}: ${error instanceof Error ? error.message : "error desconocido"}`
        ]
      }
    }

    setDuplicateReview(null)
    setIsDuplicateActionRunning(false)
    await processImageQueue(remaining, stats)
  }, [duplicateReview, electronAPI, processImageQueue])

  const handleSelectImage = useCallback((image: UploadImage) => {
    setSelectedImage(image)
  }, [])

  const handleAnalyzeImage = useCallback(() => {
    if (!selectedImage) {
      setErrorMessage("Seleccione una imagen para analizar.")
      return
    }
    setAnalysisImage(selectedImage)
    void performImageAnalysis(selectedImage)
  }, [performImageAnalysis, selectedImage])

  const handleCloseAnalysis = useCallback(() => {
    setAnalysisImage(null)
    setAnalysisResult(null)
  }, [])

  return (
    <>
      <StatusToasts statusMessage={statusMessage} errorMessage={errorMessage} />
      <div className="content transfer-view-layout">
        <div className="uploads-browser">
          <div className="uploads-browser__header">
            <div className="uploads-browser__intro">
              <h2 className="uploads-browser__title">Cobros por Transferencia</h2>
            </div>
          </div>
          <div className="uploads-browser__body">
            {isLoading ? (
              <div className="uploads-browser__empty">Cargando imagenes...</div>
            ) : images.length === 0 ? (
              <div className="uploads-browser__empty">No hay imagenes subidas</div>
            ) : (
              <div className="uploads-browser__grid">
                {images.map(image => {
                  const isSelected = selectedImage?.filePath === image.filePath
                  return (
                    <UploadsGridItem
                      key={image.filePath}
                      image={image}
                      isSelected={isSelected}
                      onSelect={handleSelectImage}
                    />
                  )
                })}
              </div>
            )}
          </div>
        </div>
        <aside className="sidebar loan-actions transfer-view-actions">
          <div className="loan-actions__button-group">
            <span className="loan-actions__section-title">Acciones</span>
            <button
              className="fetch-button"
              type="button"
              onClick={handleProcessImages}
              disabled={isProcessing || isAnalyzing || images.every(image => image.processed)}
            >
              {isProcessing ? "Procesando..." : "Procesar Imagenes"}
            </button>
            {processingProgress ? (
              <div className="transfer-processing-progress">{processingProgress}</div>
            ) : null}
            <button
              className="fetch-button"
              type="button"
              onClick={handleAnalyzeImage}
              disabled={!selectedImage || isAnalyzing || isProcessing}
            >
              {isAnalyzing ? "Analizando..." : "Analizar Imagen"}
            </button>
          </div>
          <div className="loan-actions__divider" aria-hidden="true" />
          <div className="loan-actions__button-group loan-actions__button-group--bottom">
            <button
              className="fetch-button"
              type="button"
              onClick={refreshImages}
              disabled={isLoading || isProcessing}
            >
              {isLoading ? "Cargando..." : "Actualizar"}
            </button>
          </div>
        </aside>
      </div>
      {analysisImage ? (
        <ImageAnalysisModal
          image={analysisImage}
          isAnalyzing={isAnalyzing}
          analysisResult={analysisResult}
          onClose={handleCloseAnalysis}
        />
      ) : null}
      {duplicateReview ? (
        <DuplicateTransferModal
          review={duplicateReview}
          isWorking={isDuplicateActionRunning}
          onStoreAnyway={() => void handleStoreDuplicate()}
          onSkip={() => void handleSkipDuplicate()}
        />
      ) : null}
    </>
  )
}
