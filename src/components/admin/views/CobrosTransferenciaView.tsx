import React, { useCallback, useEffect, useState } from "react"
import { useAutoDismissMessage } from "../../../hooks/useAutoDismissMessage"
import StatusToasts from "../../StatusToasts"

type UploadImage = {
  fileName: string
  filePath: string
  fileUrl: string
  dataUrl: string
  modifiedTime: number
  size: number
}

type AnalysisMatch = {
  type: "CVU" | "CBU"
  number: string
  holder?: string | null
}

type AnalysisResult = {
  match: AnalysisMatch | null
  text?: string
  amount?: string | null
}

const STATUS_DURATION_MS = 2000

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

        setAnalysisResult({
          match: response?.match ?? null,
          text: response?.text,
          amount: response?.amount ?? null
        })

        if (!response?.match) {
          setStatusMessage("No se detectaron CVU o CBU en la imagen seleccionada.")
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

  const handleSelectImage = (image: UploadImage) => {
    setSelectedImage(image)
  }

  const handleAnalyzeImage = () => {
    if (!selectedImage) {
      setErrorMessage("Seleccione una imagen para analizar.")
      return
    }
    setAnalysisImage(selectedImage)
    void performImageAnalysis(selectedImage)
  }

  const handleCloseAnalysis = () => {
    setAnalysisImage(null)
    setAnalysisResult(null)
  }

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
                    <button
                      key={image.filePath}
                      type="button"
                      className={`uploads-browser__item${isSelected ? " selected" : ""}`}
                      onClick={() => handleSelectImage(image)}
                      aria-pressed={isSelected}
                    >
                      <div className="uploads-browser__preview">
                        <img
                          src={image.dataUrl || image.fileUrl}
                          alt={image.fileName}
                          loading="lazy"
                        />
                      </div>
                      <div className="uploads-browser__caption">
                        <span className="uploads-browser__filename" title={image.fileName}>
                          {image.fileName}
                        </span>
                      </div>
                    </button>
                  )
                })}
              </div>
            )}
          </div>
        </div>
        <aside className="sidebar loan-actions transfer-view-actions">
          <div className="loan-actions__button-group">
            <span className="loan-actions__section-title">Acciones</span>
            <button className="fetch-button" type="button">
              Procesar Imagenes
            </button>
            <button
              className="fetch-button"
              type="button"
              onClick={handleAnalyzeImage}
              disabled={!selectedImage || isAnalyzing}
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
              disabled={isLoading}
            >
              {isLoading ? "Cargando..." : "Actualizar"}
            </button>
          </div>
        </aside>
      </div>
      {analysisImage ? (
        <div className="image-modal" role="dialog" aria-modal="true" onClick={handleCloseAnalysis}>
          <div className="image-modal__panel" onClick={event => event.stopPropagation()}>
            <div className="image-modal__header">
              <h3 className="image-modal__title">{analysisImage.fileName}</h3>
              <button className="image-modal__close" type="button" onClick={handleCloseAnalysis}>
                Cerrar
              </button>
            </div>
            <div className="image-modal__body">
              <div className="image-modal__preview">
                <img
                  src={analysisImage.dataUrl || analysisImage.fileUrl}
                  alt={analysisImage.fileName}
                />
              </div>
              <div className="image-modal__sidebar">
                {isAnalyzing ? (
                  <div className="ocr-status">Analizando imagen...</div>
                ) : analysisResult ? (
                  analysisResult.match ? (
                    <div className="ocr-result">
                      {analysisResult.match.holder ? (
                        <span className="ocr-result__holder">
                          Titular: {analysisResult.match.holder}
                        </span>
                      ) : null}
                      <span className="ocr-result__label">{analysisResult.match.type}</span>
                      <span className="ocr-result__value">{analysisResult.match.number}</span>
                      {analysisResult.amount ? (
                        <span className="ocr-result__amount">
                          Monto detectado: ${analysisResult.amount}
                        </span>
                      ) : null}
                    </div>
                  ) : (
                    <div className="ocr-status">
                      No se identificaron CVU o CBU en la imagen analizada.
                    </div>
                  )
                ) : (
                  <div className="ocr-status">
                    Presione &quot;Analizar Imagen&quot; para extraer CVU o CBU.
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </>
  )
}
