import React, { useCallback, useEffect, useState } from "react"
import StatusToasts from "../../StatusToasts"
import SpanishDateInput from "../../SpanishDateInput"
import { useAutoDismissMessage } from "../../../hooks/useAutoDismissMessage"

type Categoria = { codigo: string; descripcion: string; tipo_factura: string }
type Lista = { codigo: number; descripcion: string }
type Municipio = { codigo: number; nombre: string; sigla: string }
type Calle = { codigo: number; nombre: string }
type DeliveryPoint = { cod_cliente: number; nro_lugar_entrega: number; fecha_inicio_contrato: string }
type RecordRow = Record<string, unknown>
type OnboardingStep = 1 | 2 | 3 | 4 | 5

const ONBOARDING_STEPS = [
  { id: 1, label: "1. Cliente" },
  { id: 2, label: "2. Punto de entrega" },
  { id: 3, label: "3. Dispenser" },
  { id: 4, label: "4. Ruta" },
  { id: 5, label: "5. Facturacion" }
] as const

const TIPO_CLIENTE = [
  { value: "1", label: "Abonado" },
  { value: "2", label: "Cuenta corriente" },
  { value: "3", label: "Contado" }
]

const facturaEsperada = (tipoFactura: string) => {
  if (tipoFactura === "A") return "FA"
  if (tipoFactura === "B") return "FB"
  if (tipoFactura === "C") return "FC"
  return "?"
}

const todayIso = () => {
  const date = new Date()
  const month = String(date.getMonth() + 1).padStart(2, "0")
  const day = String(date.getDate()).padStart(2, "0")
  return `${date.getFullYear()}-${month}-${day}`
}

const emptyClientForm = {
  razonSocial: "", domFiscal1: "", cuit: "", tipoCliente: "1", tipoFactCtaCte: "2",
  codLista: "", limiteCredito: "", codCategoria: "", tipoCobro: "L", limiteFacturacion: ""
}

const newDeliveryForm = (codCliente = "") => ({
  codCliente,
  codMunicipio: "",
  codCalle: "",
  numeroPuerta: "",
  observDomicilio: "",
  fechaInicioContrato: todayIso(),
  codLista: "1",
  cantOptEnvases: "4",
  esLugarCobro: "S",
  telefonos: "",
  frecuenciaVisita: "1",
  email: "",
  minfExtra: "D"
})

const locationMonth = (date: string) => {
  const match = String(date || "").match(/^(\d{4})-(\d{2})-\d{2}$/)
  return match ? `${match[2]}/${match[1].slice(-2)}` : ""
}

const display = (value: unknown) => String(value ?? "").trim()

export default function ClientOnboardingView() {
  const electronAPI = window.electronAPI
  const [form, setForm] = useState(emptyClientForm)
  const [activeStep, setActiveStep] = useState<OnboardingStep>(1)
  const [deliveryForm, setDeliveryForm] = useState(() => newDeliveryForm())
  const [nextCode, setNextCode] = useState<number | null>(null)
  const [categorias, setCategorias] = useState<Categoria[]>([])
  const [listas, setListas] = useState<Lista[]>([])
  const [municipios, setMunicipios] = useState<Municipio[]>([])
  const [latestDelivery, setLatestDelivery] = useState<DeliveryPoint | null>(null)
  const [deliveryContext, setDeliveryContext] = useState<{ cod_cliente: number; razon_social: string; proximo_lugar: number } | null>(null)
  const [streetSearch, setStreetSearch] = useState("")
  const [streets, setStreets] = useState<Calle[]>([])
  const [loading, setLoading] = useState(true)
  const [savingClient, setSavingClient] = useState(false)
  const [savingDelivery, setSavingDelivery] = useState(false)
  const [statusMessage, setStatusMessage] = useState<string | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  useAutoDismissMessage(statusMessage, setStatusMessage, 3500)
  useAutoDismissMessage(errorMessage, setErrorMessage, 5000)

  const tipoCliente = Number(form.tipoCliente)
  const isCuentaCorriente = tipoCliente === 2
  const tipoFacturacion = tipoCliente === 1 ? "2" : tipoCliente === 3 ? null : form.tipoFactCtaCte
  const diaFacturacion = deliveryForm.fechaInicioContrato ? Math.min(Number(deliveryForm.fechaInicioContrato.slice(8, 10)), 28) : null

  const loadInitialData = useCallback(async () => {
    if (!electronAPI?.clientOnboardingInitialData) return setErrorMessage("Servicio de alta de clientes no disponible.")
    setLoading(true)
    try {
      const response = await electronAPI.clientOnboardingInitialData()
      if (response?.error) throw new Error(response.details || response.error)
      setNextCode(Number(response.proximo_codigo) || null)
      setCategorias(Array.isArray(response.categorias) ? response.categorias : [])
      setListas(Array.isArray(response.listas) ? response.listas : [])
      setMunicipios(Array.isArray(response.municipios) ? response.municipios : [])
      if (response.ultimo_punto?.cod_cliente && response.ultimo_punto?.nro_lugar_entrega) {
        setLatestDelivery({
          cod_cliente: Number(response.ultimo_punto.cod_cliente),
          nro_lugar_entrega: Number(response.ultimo_punto.nro_lugar_entrega),
          fecha_inicio_contrato: String(response.ultimo_punto.fecha_inicio_contrato || "")
        })
      }
      setDeliveryForm(current => current.codCliente ? current : newDeliveryForm(String(response.ultimo_codigo || "")))
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "No se pudieron cargar los datos iniciales.")
    } finally {
      setLoading(false)
    }
  }, [electronAPI])

  useEffect(() => { void loadInitialData() }, [loadInitialData])

  useEffect(() => {
    const codCliente = deliveryForm.codCliente.trim()
    if (!/^\d{1,4}$/.test(codCliente) || !electronAPI?.clientOnboardingDeliveryContext) {
      setDeliveryContext(null)
      return
    }
    const timer = window.setTimeout(async () => {
      try {
        const response = await electronAPI.clientOnboardingDeliveryContext({ codCliente })
        if (response?.error) throw new Error(response.details || response.error)
        setDeliveryContext(response?.cod_cliente ? {
          cod_cliente: Number(response.cod_cliente),
          razon_social: String(response.razon_social || ""),
          proximo_lugar: Number(response.proximo_lugar)
        } : null)
      } catch (error) {
        setDeliveryContext(null)
        setErrorMessage(error instanceof Error ? error.message : "No se pudo consultar el cliente.")
      }
    }, 180)
    return () => window.clearTimeout(timer)
  }, [deliveryForm.codCliente, electronAPI])

  useEffect(() => {
    const municipio = deliveryForm.codMunicipio
    const query = streetSearch.trim()
    if (!municipio || deliveryForm.codCalle || query.length < 2 || !electronAPI?.clientOnboardingSearchStreets) {
      setStreets([])
      return
    }
    let cancelled = false
    const timer = window.setTimeout(async () => {
      try {
        const response = await electronAPI.clientOnboardingSearchStreets({ codMunicipio: municipio, query })
        if (!Array.isArray(response)) throw new Error(response.details || response.error)
        if (!cancelled) setStreets(response)
      } catch (error) {
        if (!cancelled) {
          setStreets([])
          setErrorMessage(error instanceof Error ? error.message : "No se pudieron buscar calles.")
        }
      }
    }, 180)
    return () => { cancelled = true; window.clearTimeout(timer) }
  }, [deliveryForm.codCalle, deliveryForm.codMunicipio, electronAPI, streetSearch])

  const update = (field: keyof typeof emptyClientForm, value: string) => {
    setForm(current => {
      if (field === "tipoCliente") {
        return { ...current, tipoCliente: value, tipoCobro: value === "1" ? "L" : "N", codLista: value === "2" ? current.codLista : "" }
      }
      return { ...current, [field]: field === "cuit" ? value.replace(/\D/g, "").slice(0, 18) : value }
    })
  }

  const updateDelivery = (field: keyof ReturnType<typeof newDeliveryForm>, value: string) => {
    setDeliveryForm(current => {
      if (field === "codCliente") return { ...current, codCliente: value.replace(/\D/g, "").slice(0, 4) }
      if (field === "codMunicipio") {
        setStreetSearch("")
        setStreets([])
        return { ...current, codMunicipio: value, codCalle: "" }
      }
      if (["numeroPuerta", "cantOptEnvases", "frecuenciaVisita"].includes(field)) return { ...current, [field]: value.replace(/\D/g, "") }
      return { ...current, [field]: value }
    })
  }

  const saveClient = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!electronAPI?.createOnboardingClient) return setErrorMessage("Servicio de alta de clientes no disponible.")
    setSavingClient(true)
    setStatusMessage(null)
    setErrorMessage(null)
    try {
      const response = await electronAPI.createOnboardingClient({ ...form, tipoFactCtaCte: tipoFacturacion, codLista: isCuentaCorriente ? form.codLista : null })
      if (response?.error) throw new Error(response.details || response.error)
      const createdCode = Number(response.cod_cliente)
      setStatusMessage(`Cliente ${createdCode} creado correctamente.`)
      setNextCode(createdCode + 1)
      setDeliveryForm(newDeliveryForm(String(createdCode)))
      setLatestDelivery(null)
      setStreetSearch("")
      setStreets([])
      setForm(emptyClientForm)
      setActiveStep(2)
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "No se pudo crear el cliente.")
    } finally {
      setSavingClient(false)
    }
  }

  const saveDelivery = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!electronAPI?.createOnboardingDelivery) return setErrorMessage("Servicio de alta de puntos de entrega no disponible.")
    if (!deliveryContext) return setErrorMessage("Seleccionar un codigo de cliente existente.")
    if (!deliveryForm.codCalle) return setErrorMessage("Seleccionar una calle de la lista.")
    setSavingDelivery(true)
    setStatusMessage(null)
    setErrorMessage(null)
    try {
      const response = await electronAPI.createOnboardingDelivery(deliveryForm)
      if (response?.error) throw new Error(response.details || response.error)
      setStatusMessage(`Punto ${response.nro_lugar_entrega} creado para el cliente ${response.cod_cliente}.`)
      setDeliveryContext(current => current ? { ...current, proximo_lugar: Number(response.nro_lugar_entrega) + 1 } : current)
      setLatestDelivery({
        cod_cliente: Number(response.cod_cliente),
        nro_lugar_entrega: Number(response.nro_lugar_entrega),
        fecha_inicio_contrato: String(response.fecha_inicio_contrato || deliveryForm.fechaInicioContrato)
      })
      setDeliveryForm(newDeliveryForm(deliveryForm.codCliente))
      setStreetSearch("")
      setStreets([])
      setActiveStep(3)
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "No se pudo crear el punto de entrega.")
    } finally {
      setSavingDelivery(false)
    }
  }

  return <div className="content client-onboarding-layout">
    <StatusToasts statusMessage={statusMessage} errorMessage={errorMessage} />
    <main className="client-onboarding-main">
      <div className="client-onboarding-heading"><div><h2>Alta de cliente</h2><p>Cliente y punto de entrega.</p></div></div>
      <div className="client-onboarding-steps" aria-label="Pasos de alta">{ONBOARDING_STEPS.map(step => <button type="button" key={step.id} onClick={() => setActiveStep(step.id as OnboardingStep)} className={`client-onboarding-step${step.id === activeStep ? " client-onboarding-step--active" : ""}${step.id < activeStep ? " client-onboarding-step--complete" : ""}`}>{step.label}</button>)}</div>

      {activeStep === 1 && <form className="client-onboarding-form" onSubmit={saveClient}>
        <section><h3>1. Cliente</h3><div className="client-onboarding-grid">
          <label className="client-onboarding-field client-onboarding-field--wide"><span>Razon social</span><input required maxLength={60} value={form.razonSocial} onChange={event => update("razonSocial", event.target.value)} /></label>
          <label className="client-onboarding-field client-onboarding-field--wide"><span>Domicilio fiscal</span><input required maxLength={30} value={form.domFiscal1} onChange={event => update("domFiscal1", event.target.value)} /></label>
          <label className="client-onboarding-field"><span>CUIT / ID</span><input required maxLength={18} inputMode="numeric" placeholder="CUIT o identificador" value={form.cuit} onChange={event => update("cuit", event.target.value)} /></label>
          <label className="client-onboarding-field"><span>Tipo de cliente</span><select value={form.tipoCliente} onChange={event => update("tipoCliente", event.target.value)}>{TIPO_CLIENTE.map(option => <option key={option.value} value={option.value}>{option.value} - {option.label}</option>)}</select></label>
          <label className="client-onboarding-field"><span>Facturacion CC</span>{isCuentaCorriente ? <select value={form.tipoFactCtaCte} onChange={event => update("tipoFactCtaCte", event.target.value)}><option value="1">1 - Factura compartida</option><option value="2">2 - Factura por punto</option></select> : <input readOnly value={tipoCliente === 1 ? "2 - Factura por punto" : "No aplica"} />}</label>
          <label className="client-onboarding-field"><span>Lista de precios</span>{isCuentaCorriente ? <select required value={form.codLista} onChange={event => update("codLista", event.target.value)}><option value="">Seleccionar</option>{listas.map(lista => <option key={lista.codigo} value={lista.codigo}>{lista.codigo} - {lista.descripcion}</option>)}</select> : <input readOnly value="No aplica" />}</label>
          <label className="client-onboarding-field"><span>Limite de credito</span><input inputMode="decimal" placeholder="Sin limite" value={form.limiteCredito} onChange={event => update("limiteCredito", event.target.value)} /></label>
          <label className="client-onboarding-field"><span>Limite de facturacion</span><input inputMode="decimal" placeholder="Sin limite" value={form.limiteFacturacion} onChange={event => update("limiteFacturacion", event.target.value)} /></label>
          <label className="client-onboarding-field"><span>Frecuencia</span><input readOnly value="M - Mensual" /></label>
          <label className="client-onboarding-field"><span>Tipo de cobro</span><select value={form.tipoCobro} onChange={event => update("tipoCobro", event.target.value)}><option value="N">N - Sin definir</option><option value="L">L</option><option value="U">U</option></select></label>
          <label className="client-onboarding-field"><span>Categoria IVA</span><select required value={form.codCategoria} onChange={event => update("codCategoria", event.target.value)}><option value="">Seleccionar</option>{categorias.map(category => <option key={category.codigo} value={category.codigo}>{category.codigo} - {category.descripcion} ({facturaEsperada(category.tipo_factura)})</option>)}</select></label>
        </div></section>
        <footer className="client-onboarding-footer"><span>Estado inicial: activo (0) · Consumo minimo CC: 0</span><button className="fetch-button fetch-button--success" type="submit" disabled={loading || savingClient}>{savingClient ? "Creando..." : "Crear cliente"}</button></footer>
      </form>}

      {activeStep === 2 && <form className="client-onboarding-form" onSubmit={saveDelivery}>
        <section><h3>2. Punto de entrega</h3><div className="client-onboarding-grid">
          <label className="client-onboarding-field"><span>Codigo de cliente</span><input required inputMode="numeric" value={deliveryForm.codCliente} onFocus={event => event.currentTarget.select()} onChange={event => updateDelivery("codCliente", event.target.value)} />{deliveryContext && <small>{deliveryContext.razon_social}</small>}</label>
          <label className="client-onboarding-field"><span>Nro. lugar de entrega</span><input readOnly value={deliveryContext?.proximo_lugar ?? "-"} /></label>
          <label className="client-onboarding-field"><span>Tipo de lugar</span><select value="E" disabled><option value="E">E</option></select></label>
          <label className="client-onboarding-field"><span>Municipio</span><select required value={deliveryForm.codMunicipio} onChange={event => updateDelivery("codMunicipio", event.target.value)}><option value="">Seleccionar</option>{municipios.map(municipio => <option key={municipio.codigo} value={municipio.codigo}>{municipio.codigo} - {municipio.nombre} ({municipio.sigla})</option>)}</select></label>
          <div className="client-onboarding-street-field client-onboarding-field--wide"><label className="client-onboarding-field"><span>Calle</span><input disabled={!deliveryForm.codMunicipio} value={streetSearch} placeholder={deliveryForm.codMunicipio ? "Buscar calle" : "Seleccionar municipio"} onChange={event => { setStreetSearch(event.target.value); updateDelivery("codCalle", "") }} />{streets.length > 0 && <span className="client-onboarding-street-results">{streets.map(street => <button type="button" key={street.codigo} onClick={() => { updateDelivery("codCalle", String(street.codigo)); setStreetSearch(street.nombre); setStreets([]) }}>{street.codigo} - {street.nombre}</button>)}</span>}</label><label className="client-onboarding-field client-onboarding-street-code"><span>Cod.</span><input readOnly value={deliveryForm.codCalle || "-"} /></label></div>
          <label className="client-onboarding-field"><span>Numero de puerta</span><input required inputMode="numeric" value={deliveryForm.numeroPuerta} onChange={event => updateDelivery("numeroPuerta", event.target.value)} /></label>
          <label className="client-onboarding-field client-onboarding-field--wide"><span>Observacion domicilio</span><input maxLength={40} value={deliveryForm.observDomicilio} onChange={event => updateDelivery("observDomicilio", event.target.value)} /></label>
          <label className="client-onboarding-field"><span>Inicio de contrato</span><SpanishDateInput value={deliveryForm.fechaInicioContrato} onChange={value => updateDelivery("fechaInicioContrato", value)} ariaLabel="Inicio de contrato" /></label>
          <label className="client-onboarding-field"><span>Lista de precios</span><select value={deliveryForm.codLista} onChange={event => updateDelivery("codLista", event.target.value)}>{listas.map(lista => <option key={lista.codigo} value={lista.codigo}>{lista.codigo} - {lista.descripcion}</option>)}</select></label>
          <label className="client-onboarding-field"><span>Dia facturacion abono</span><input readOnly value={diaFacturacion ?? "-"} /></label>
          <label className="client-onboarding-field"><span>Cant. optima envases</span><input required inputMode="numeric" value={deliveryForm.cantOptEnvases} onChange={event => updateDelivery("cantOptEnvases", event.target.value)} /></label>
          <label className="client-onboarding-field"><span>Es lugar de cobro</span><select value={deliveryForm.esLugarCobro} onChange={event => updateDelivery("esLugarCobro", event.target.value)}><option value="S">S</option><option value="N">N</option></select></label>
          <label className="client-onboarding-field"><span>Telefonos</span><input maxLength={50} value={deliveryForm.telefonos} onChange={event => updateDelivery("telefonos", event.target.value)} /></label>
          <label className="client-onboarding-field"><span>Frecuencia visita</span><input required inputMode="numeric" value={deliveryForm.frecuenciaVisita} onChange={event => updateDelivery("frecuenciaVisita", event.target.value)} /></label>
          <label className="client-onboarding-field client-onboarding-field--wide"><span>Email</span><input maxLength={60} value={deliveryForm.email} onChange={event => updateDelivery("email", event.target.value)} /></label>
          <label className="client-onboarding-field"><span>Minf extra</span><select value={deliveryForm.minfExtra} onChange={event => updateDelivery("minfExtra", event.target.value)}><option value="D">D</option><option value="B">B</option></select></label>
        </div></section>
        <footer className="client-onboarding-footer"><span>El dia de abono toma el dia de instalacion, con tope 28.</span><button className="fetch-button fetch-button--success" type="submit" disabled={loading || savingDelivery}>{savingDelivery ? "Creando..." : "Crear punto de entrega"}</button></footer>
      </form>}
      {activeStep === 3 && <OnboardingDispenserStep
        point={latestDelivery}
        onStatus={setStatusMessage}
        onError={setErrorMessage}
        onInstalled={() => setActiveStep(4)}
      />}
      {activeStep === 4 && <OnboardingRouteStep point={latestDelivery} onStatus={setStatusMessage} onError={setErrorMessage} />}
      {activeStep === 5 && <OnboardingBillingStep point={latestDelivery} onStatus={setStatusMessage} onError={setErrorMessage} />}
    </main>
  </div>
}

type BillingCandidate = {
  cliente: number
  punto: number
  razon_social?: string | null
  tipo: string
  prefijo: number
  destino: string
  total: number
  dispensers: number
  items: number
  periodo: string
  fecha_vencimiento?: string | null
  estado?: string
  motivo?: string | null
}

const billingMonth = () => todayIso().slice(0, 7)

const billingRange = (period: string) => {
  if (!/^\d{4}-\d{2}$/.test(period)) return null
  const [year, month] = period.split("-").map(Number)
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate()
  return { desde: `${period}-01`, hasta: `${period}-${String(lastDay).padStart(2, "0")}` }
}

const money = (value: unknown) => new Intl.NumberFormat("es-AR", {
  style: "currency", currency: "ARS", minimumFractionDigits: 2, maximumFractionDigits: 2
}).format(Number(value || 0))

function OnboardingBillingStep({
  point,
  onStatus,
  onError
}: {
  point: DeliveryPoint | null
  onStatus: (message: string | null) => void
  onError: (message: string | null) => void
}) {
  const electronAPI = window.electronAPI
  const [period, setPeriod] = useState(billingMonth)
  const [clientSearch, setClientSearch] = useState("")
  const [clientCode, setClientCode] = useState("")
  const [suggestions, setSuggestions] = useState<Array<{ cod_cliente: number; nro_lugar_entrega: number; direccion?: string | null }>>([])
  const [clientContext, setClientContext] = useState<RecordRow | null>(null)
  const [candidates, setCandidates] = useState<BillingCandidate[]>([])
  const [scope, setScope] = useState("")
  const [confirmed, setConfirmed] = useState(false)
  const [loading, setLoading] = useState(false)
  const [results, setResults] = useState<RecordRow[]>([])
  const range = billingRange(period)

  useEffect(() => {
    if (!point) return
    setClientCode(String(point.cod_cliente))
    setClientSearch(String(point.cod_cliente))
  }, [point?.cod_cliente])

  useEffect(() => {
    const query = clientSearch.trim()
    if (query.length < 2 || !electronAPI?.movimientosSearchLocations || (clientContext && clientCode)) {
      setSuggestions([])
      return
    }
    let cancelled = false
    const timer = window.setTimeout(async () => {
      try {
        const response = await electronAPI.movimientosSearchLocations({ environment: "produccion", query, limit: 25 })
        if (response?.error) throw new Error(response.details || response.error)
        const byLocation = new Map<string, { cod_cliente: number; nro_lugar_entrega: number; direccion?: string | null }>()
        for (const row of (response?.result || []) as Array<RecordRow>) {
          const code = Number(row.cod_cliente)
          const deliveryPoint = Number(row.nro_lugar_entrega)
          const key = `${code}/${deliveryPoint}`
          if (Number.isFinite(code) && Number.isFinite(deliveryPoint) && !byLocation.has(key)) {
            byLocation.set(key, { cod_cliente: code, nro_lugar_entrega: deliveryPoint, direccion: display(row.direccion) || null })
          }
        }
        if (!cancelled) setSuggestions([...byLocation.values()].slice(0, 8))
      } catch (error) {
        if (!cancelled) setSuggestions([])
      }
    }, 180)
    return () => { cancelled = true; window.clearTimeout(timer) }
  }, [clientContext, clientSearch, electronAPI])

  useEffect(() => {
    if (!/^\d{1,4}$/.test(clientCode) || !electronAPI?.clientOnboardingBillingClientContext) {
      setClientContext(null)
      return
    }
    const timer = window.setTimeout(async () => {
      try {
        const response = await electronAPI.clientOnboardingBillingClientContext({ codCliente: clientCode })
        if (response?.error) throw new Error(response.details || response.error)
        if (!response?.cod_cliente) throw new Error("Cliente inexistente.")
        setClientContext(response as RecordRow)
        setClientSearch(current => /^\d+$/.test(current.trim()) ? display((response.ultimo_punto as RecordRow | null)?.direccion) || current : current)
        setSuggestions([])
      } catch (error) {
        setClientContext(null)
        onError(error instanceof Error ? error.message : "No se pudo consultar el cliente.")
      }
    }, 120)
    return () => window.clearTimeout(timer)
  }, [clientCode, electronAPI, onError])

  useEffect(() => {
    setCandidates([])
    setScope("")
    setConfirmed(false)
    setResults([])
  }, [period, clientCode])

  const selectClient = (client: { cod_cliente: number; nro_lugar_entrega: number; direccion?: string | null }) => {
    setClientCode(String(client.cod_cliente))
    setClientSearch(display(client.direccion))
    setClientContext(null)
    setSuggestions([])
  }

  const preview = async () => {
    if (!clientContext || !range) return onError("Seleccione un cliente y un periodo valido.")
    if (Number(clientContext.tipo_cliente) !== 1) return onError("La facturacion de abonos solo aplica a clientes abonados.")
    if (!electronAPI?.previewAbonos) return onError("Servicio de abonos no disponible.")
    setLoading(true)
    setCandidates([])
    setScope("")
    setConfirmed(false)
    setResults([])
    onStatus(null)
    onError(null)
    try {
      const response = await electronAPI.previewAbonos({
        environment: "produccion",
        ...range,
        fechaEmision: todayIso(),
        representada: "20220334857",
        limit: "1000"
      })
      if (response?.error) throw new Error(response.details || response.error)
      const clientCandidates = (response.candidatos || []).filter(row => Number(row.cliente) === Number(clientContext.cod_cliente)) as BillingCandidate[]
      if (!clientCandidates.length) throw new Error(`El cliente ${display(clientContext.cod_cliente)} no tiene abonos facturables en ${period}.`)
      const alreadyBilled = clientCandidates.some(row => String(row.motivo || "").toLowerCase().includes("duplicidad"))
      const latestPoint = Number((clientContext.ultimo_punto as RecordRow | null)?.nro_lugar_entrega)
      const resolved = alreadyBilled
        ? clientCandidates.filter(row => row.punto === latestPoint)
        : clientCandidates
      if (!resolved.length) throw new Error("El punto de entrega mas nuevo no tiene un abono facturable para este periodo.")
      setCandidates(resolved)
      setScope(alreadyBilled
        ? `El cliente ya tiene un abono en ${period}; se facturara solo el punto nuevo ${latestPoint}.`
        : `Se facturaran los ${resolved.length} punto(s) facturables del cliente.`)
      const readyCount = resolved.filter(row => row.estado === "listo").length
      onStatus(readyCount ? `${readyCount} abono(s) listos para confirmar.` : "No hay abonos listos para generar.")
    } catch (error) {
      onError(error instanceof Error ? error.message : "No se pudo previsualizar la facturacion.")
    } finally {
      setLoading(false)
    }
  }

  const generate = async () => {
    const readyCandidates = candidates.filter(candidate => candidate.estado === "listo")
    if (!clientContext || !range || !readyCandidates.length || !confirmed) return onError("Previsualice al menos un abono listo y confirme la generacion.")
    if (!electronAPI?.generateAbonos) return onError("Servicio de generacion de abonos no disponible.")
    setLoading(true)
    setResults([])
    onStatus(null)
    onError(null)
    try {
      const response = await electronAPI.generateAbonos({
        environment: "produccion",
        ...range,
        fechaEmision: todayIso(),
        representada: "20220334857",
        limit: String(readyCandidates.length),
        confirmation: "CONFIRMAR_ABONOS_PRODUCCION",
        selectedCandidates: readyCandidates.map(candidate => ({ codCliente: candidate.cliente, nroLugarEntrega: candidate.punto }))
      })
      if (response?.error) throw new Error(response.details || response.error)
      const billingResults = (response.resultados || []) as RecordRow[]
      const failed = billingResults.find(row => !row.ok)
      if (failed) throw new Error(display(failed.error) || "La facturacion no pudo completarse.")
      setResults(billingResults)
      setConfirmed(false)
      onStatus(`Facturacion completada: ${billingResults.length} comprobante(s).`)
    } catch (error) {
      onError(error instanceof Error ? error.message : "No se pudo generar el abono.")
    } finally {
      setLoading(false)
    }
  }

  const readyCandidates = candidates.filter(candidate => candidate.estado === "listo")
  return <section className="client-onboarding-dispenser client-onboarding-billing">
    <h3>5. Facturacion de abono</h3>
    <div className="client-onboarding-grid">
      <label className="client-onboarding-field client-onboarding-field--wide"><span>Cliente</span><input value={clientSearch} placeholder="Buscar domicilio o codigo" onChange={event => { const value = event.target.value; setClientSearch(value); setClientCode(/^\d{1,4}$/.test(value.trim()) ? value.trim() : ""); setClientContext(null) }} />{clientContext && <small>Cliente {display(clientContext.cod_cliente)} · {Array.isArray(clientContext.puntos) ? clientContext.puntos.length : 0} punto(s) activo(s)</small>}{suggestions.length > 0 && <span className="client-onboarding-route-results">{suggestions.map(row => <button type="button" key={`${row.cod_cliente}/${row.nro_lugar_entrega}`} onClick={() => selectClient(row)}><strong>{row.direccion || "Domicilio sin cargar"}</strong><small>Cliente {row.cod_cliente} / Punto {row.nro_lugar_entrega}</small></button>)}</span>}</label>
      <label className="client-onboarding-field"><span>Periodo a facturar</span><input type="month" value={period} onChange={event => setPeriod(event.target.value)} /></label>
      <label className="client-onboarding-field"><span>Fecha de emision</span><input readOnly value={todayIso().split("-").reverse().join("/")} /></label>
      <button type="button" className="fetch-button" disabled={!clientContext || loading} onClick={() => void preview()}>{loading ? "Consultando..." : "Previsualizar"}</button>
    </div>
    <div className={`client-onboarding-route-preview${readyCandidates.length ? " client-onboarding-route-preview--ready" : ""}`}>
      {candidates.length
        ? <><strong>{display(clientContext?.razon_social) || "Cliente"}</strong>{` · ${scope} `}<span>{readyCandidates.length} listo(s) de {candidates.length} punto(s).</span></>
        : "Seleccione el cliente y el mes. La fecha de vencimiento toma el dia de facturacion de cada punto."}
    </div>
    {candidates.map(candidate => <div className={`client-onboarding-billing-row${candidate.estado === "listo" ? " client-onboarding-billing-row--ready" : ""}`} key={`${candidate.cliente}/${candidate.punto}`}><strong>Punto {candidate.punto}</strong><span>{candidate.tipo}/{candidate.prefijo} · {candidate.dispensers} disp. · {money(candidate.total)}</span><span>Vto. {candidate.fecha_vencimiento ? candidate.fecha_vencimiento.split("-").reverse().join("/") : "-"}</span><span>{candidate.motivo || "Listo"}</span></div>)}
    {results.length > 0 && <div className="client-onboarding-route-preview client-onboarding-route-preview--ready">{results.map(row => `${display(row.tipo_comprobante)}/${display(row.prefijo)}-${display(row.numero)}${display(row.cae) ? ` · CAE ${display(row.cae)}` : ""}`).join(" | ")}</div>}
    <footer className="client-onboarding-footer"><span>El control de duplicidad se aplica antes de generar cada punto.</span><label className="movimientos-check"><input type="checkbox" disabled={!readyCandidates.length || loading} checked={confirmed} onChange={event => setConfirmed(event.target.checked)} /><span>Confirmar {readyCandidates.length} abono(s)</span></label><button type="button" className="fetch-button fetch-button--success" disabled={!readyCandidates.length || !confirmed || loading} onClick={() => void generate()}>{loading ? "Generando..." : "Generar abonos"}</button></footer>
  </section>
}

function OnboardingDispenserStep({
  point,
  onStatus,
  onError,
  onInstalled
}: {
  point: DeliveryPoint | null
  onStatus: (message: string | null) => void
  onError: (message: string | null) => void
  onInstalled: () => void
}) {
  const electronAPI = window.electronAPI
  const [codDispenser, setCodDispenser] = useState("")
  const [codAbono, setCodAbono] = useState("")
  const [abonoOptions, setAbonoOptions] = useState<RecordRow[]>([])
  const [dispenser, setDispenser] = useState<RecordRow | null>(null)
  const [preview, setPreview] = useState<RecordRow | null>(null)
  const [confirmed, setConfirmed] = useState(false)
  const [loading, setLoading] = useState(false)

  const ubicacion = locationMonth(point?.fecha_inicio_contrato || "")
  const payload = {
    environment: "produccion",
    mode: "instalacion" as const,
    codCliente: point?.cod_cliente || "",
    nroLugarEntrega: point?.nro_lugar_entrega || "",
    codDispenserInstalado: codDispenser,
    codAbono,
    ubicacion
  }

  const resetVerification = () => {
    setPreview(null)
    setConfirmed(false)
  }

  useEffect(() => {
    if (!electronAPI?.dispensersInitialData) return
    electronAPI.dispensersInitialData({ environment: "produccion" })
      .then(response => {
        if (response.error) throw new Error(response.details || response.error)
        setAbonoOptions((response.result?.abonos as RecordRow[]) || [])
      })
      .catch(error => onError(error instanceof Error ? error.message : "No se pudieron cargar los abonos."))
  }, [electronAPI, onError])

  useEffect(() => {
    setCodDispenser("")
    setCodAbono("")
    setDispenser(null)
    resetVerification()
  }, [point?.cod_cliente, point?.nro_lugar_entrega, point?.fecha_inicio_contrato])

  const loadDispenser = async () => {
    const code = codDispenser.trim()
    if (!code) {
      setDispenser(null)
      return
    }
    if (!electronAPI?.dispensersDispenser) return onError("Consulta de dispensers no disponible.")
    try {
      const response = await electronAPI.dispensersDispenser({ environment: "produccion", codDispenser: code })
      if (response.error) throw new Error(response.details || response.error)
      setDispenser((response.result as RecordRow) || null)
      resetVerification()
    } catch (error) {
      setDispenser(null)
      onError(error instanceof Error ? error.message : "No se pudo consultar el dispenser.")
    }
  }

  const verify = async () => {
    if (!point) return onError("Primero cree o seleccione un punto de entrega.")
    if (!electronAPI?.dispensersPreview) return onError("Servicio de dispensers no disponible.")
    setLoading(true)
    onStatus(null)
    onError(null)
    try {
      const response = await electronAPI.dispensersPreview(payload)
      if (response.error) throw new Error(response.details || response.error)
      setPreview((response.result as RecordRow) || null)
      setConfirmed(false)
      onStatus("Dispenser disponible y datos verificados.")
    } catch (error) {
      setPreview(null)
      onError(error instanceof Error ? error.message : "No se pudo verificar la instalacion.")
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (!point || !codDispenser.trim() || !codAbono || !ubicacion || !dispenser || Number(dispenser.cod_cliente || 0) !== 0) {
      return
    }
    const timer = window.setTimeout(() => { void verify() }, 120)
    return () => window.clearTimeout(timer)
  }, [codAbono, codDispenser, dispenser, point, ubicacion])

  const save = async () => {
    if (!preview || !confirmed) return onError("Verifique los datos y confirme la instalacion antes de guardar.")
    if (!electronAPI?.dispensersSave) return onError("Servicio de dispensers no disponible.")
    setLoading(true)
    onStatus(null)
    onError(null)
    try {
      const response = await electronAPI.dispensersSave(payload)
      if (response.error) throw new Error(response.details || response.error)
      onStatus(`Dispenser ${codDispenser} instalado en ${point?.cod_cliente}/${point?.nro_lugar_entrega}.`)
      setCodDispenser("")
      setCodAbono("")
      setDispenser(null)
      resetVerification()
      onInstalled()
    } catch (error) {
      onError(error instanceof Error ? error.message : "No se pudo instalar el dispenser.")
    } finally {
      setLoading(false)
    }
  }

  const assigned = Number(dispenser?.cod_cliente || 0) !== 0
  const canVerify = Boolean(point && codDispenser.trim() && codAbono && ubicacion && dispenser && !assigned && !loading)

  return <section className="client-onboarding-dispenser">
    <h3>3. Instalar dispenser</h3>
    <div className="client-onboarding-grid">
      <label className="client-onboarding-field"><span>Cliente / punto</span><input readOnly value={point ? `${point.cod_cliente} / ${point.nro_lugar_entrega}` : "Crear punto de entrega"} /></label>
      <label className="client-onboarding-field"><span>Ubicacion</span><input readOnly value={ubicacion || "-"} /></label>
      <label className="client-onboarding-field"><span>Cod. dispenser</span><input disabled={!point} inputMode="numeric" value={codDispenser} onChange={event => { setCodDispenser(event.target.value.replace(/\D/g, "")); setDispenser(null); resetVerification() }} onBlur={() => void loadDispenser()} onKeyDown={event => { if (event.key === "Enter") { event.preventDefault(); void loadDispenser() } }} /></label>
      <label className="client-onboarding-field client-onboarding-field--wide"><span>Abono / alquiler</span><select disabled={!point} value={codAbono} onChange={event => { setCodAbono(event.target.value); resetVerification() }}><option value="">Seleccionar</option>{abonoOptions.map(option => <option key={display(option.cod_item)} value={display(option.cod_item)}>{display(option.cod_item)} - {display(option.denom_corto || option.denominacion)}</option>)}</select></label>
    </div>
    <div className={`client-onboarding-dispenser-status${dispenser ? (assigned ? " client-onboarding-dispenser-status--busy" : " client-onboarding-dispenser-status--ready") : ""}`}>
      {dispenser ? assigned ? `No disponible: asignado a ${display(dispenser.cod_cliente)}/${display(dispenser.nro_lugar_entrega)}. Marca: ${display(dispenser.marca) || "-"}.` : `Disponible: ${display(dispenser.cod_dispenser)}${display(dispenser.nro_serie) ? ` - ${display(dispenser.nro_serie)}` : ""}. Marca: ${display(dispenser.marca) || "-"}.` : "Ingrese un codigo de dispenser para consultar su disponibilidad."}
    </div>
    <footer className="client-onboarding-footer">
      <span>{canVerify ? "Disponibilidad validada automaticamente al seleccionar el abono." : "Seleccione un dispenser disponible y su abono."}</span>
      <label className="movimientos-check"><input type="checkbox" checked={confirmed} disabled={!preview || loading} onChange={event => setConfirmed(event.target.checked)} /><span>Confirmar instalacion</span></label>
      <button type="button" className="fetch-button fetch-button--success" onClick={() => void save()} disabled={!preview || !confirmed || loading}>{loading ? "Guardando..." : "Instalar dispenser"}</button>
    </footer>
  </section>
}

type RouteReference = { cod_cliente: number; nro_lugar_entrega: number; razon_social: string; direccion: string }
type RouteOption = { cod_ruta: string; ruta_descripcion: string; orden_circuito: number; l_entrega?: string; l_cobro?: string }

function OnboardingRouteStep({
  point,
  onStatus,
  onError
}: {
  point: DeliveryPoint | null
  onStatus: (message: string | null) => void
  onError: (message: string | null) => void
}) {
  const electronAPI = window.electronAPI
  const [targetClient, setTargetClient] = useState("")
  const [targetPoint, setTargetPoint] = useState("")
  const [referenceSearch, setReferenceSearch] = useState("")
  const [referenceRows, setReferenceRows] = useState<RouteReference[]>([])
  const [reference, setReference] = useState<RouteReference | null>(null)
  const [routeOptions, setRouteOptions] = useState<RouteOption[]>([])
  const [route, setRoute] = useState<RouteOption | null>(null)
  const [lEntrega, setLEntrega] = useState("S")
  const [lCobro, setLCobro] = useState("S")
  const [preview, setPreview] = useState<{ orden_nuevo?: number; orden_referencia_normalizado?: number; clientes_a_espaciar?: number } | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!point) return
    setTargetClient(String(point.cod_cliente))
    setTargetPoint(String(point.nro_lugar_entrega))
  }, [point?.cod_cliente, point?.nro_lugar_entrega])

  useEffect(() => {
    const query = referenceSearch.trim()
    if (reference && query === `${reference.razon_social} - ${reference.direccion}`) {
      setReferenceRows([])
      return
    }
    if (query.length < 2 || !electronAPI?.clientOnboardingSearchRouteReferences) {
      setReferenceRows([])
      return
    }
    const timer = window.setTimeout(async () => {
      try {
        const response = await electronAPI.clientOnboardingSearchRouteReferences({ query })
        if (!Array.isArray(response)) throw new Error(response.details || response.error)
        setReferenceRows(response)
      } catch (error) {
        setReferenceRows([])
        onError(error instanceof Error ? error.message : "No se pudieron buscar referencias de ruta.")
      }
    }, 180)
    return () => window.clearTimeout(timer)
  }, [electronAPI, onError, reference, referenceSearch])

  const selectReference = async (row: RouteReference) => {
    if (!electronAPI?.clientOnboardingReferenceRoutes) return onError("Consulta de rutas no disponible.")
    setReference(row)
    setReferenceSearch(`${row.razon_social} - ${row.direccion}`)
    setReferenceRows([])
    setRoute(null)
    setRouteOptions([])
    setPreview(null)
    try {
      const response = await electronAPI.clientOnboardingReferenceRoutes({ codCliente: row.cod_cliente, nroLugarEntrega: row.nro_lugar_entrega })
      if (!Array.isArray(response)) throw new Error(response.details || response.error)
      setRouteOptions(response)
    } catch (error) {
      onError(error instanceof Error ? error.message : "No se pudieron cargar las rutas de referencia.")
    }
  }

  const routePayload = route && reference ? {
    codRuta: route.cod_ruta,
    referenciaCliente: reference.cod_cliente,
    referenciaPunto: reference.nro_lugar_entrega,
    referenciaOrden: route.orden_circuito,
    codCliente: targetClient,
    nroLugarEntrega: targetPoint,
    lEntrega,
    lCobro
  } : null

  useEffect(() => {
    if (!routePayload || !/^\d{1,4}$/.test(targetClient) || !/^\d{1,2}$/.test(targetPoint) || !electronAPI?.clientOnboardingPreviewRoute) {
      setPreview(null)
      return
    }
    const timer = window.setTimeout(async () => {
      try {
        const response = await electronAPI.clientOnboardingPreviewRoute(routePayload)
        if (response?.error) throw new Error(response.details || response.error)
        setPreview(response)
      } catch (error) {
        setPreview(null)
        onError(error instanceof Error ? error.message : "No se pudo preparar la ruta.")
      }
    }, 150)
    return () => window.clearTimeout(timer)
  }, [electronAPI, lCobro, lEntrega, onError, reference, route, targetClient, targetPoint])

  const save = async () => {
    if (!routePayload || !preview) return onError("Seleccione la referencia y la ruta antes de asignar.")
    if (!electronAPI?.createOnboardingRoute) return onError("Alta de ruta no disponible.")
    setSaving(true)
    onStatus(null)
    onError(null)
    try {
      const response = await electronAPI.createOnboardingRoute(routePayload)
      if (response?.error) throw new Error(response.details || response.error)
      onStatus(`Ruta ${response.cod_ruta}: cliente ${response.cod_cliente}/${response.nro_lugar_entrega} agregado en orden ${response.orden_circuito}.`)
      setPreview(null)
    } catch (error) {
      onError(error instanceof Error ? error.message : "No se pudo asignar la ruta.")
    } finally {
      setSaving(false)
    }
  }

  return <section className="client-onboarding-dispenser client-onboarding-route">
    <h3>4. Ruta</h3>
    <div className="client-onboarding-grid">
      <label className="client-onboarding-field client-onboarding-field--wide"><span>Direccion de referencia</span><input value={referenceSearch} placeholder="Cliente, calle o numero" onChange={event => { setReferenceSearch(event.target.value); setReference(null); setRoute(null); setRouteOptions([]); setPreview(null) }} />{reference && <small>Referencia elegida: Cliente {reference.cod_cliente} / Punto {reference.nro_lugar_entrega}</small>}{referenceRows.length > 0 && <span className="client-onboarding-route-results">{referenceRows.map(row => <button type="button" key={`${row.cod_cliente}-${row.nro_lugar_entrega}`} onClick={() => void selectReference(row)}><strong>{row.razon_social}</strong><span>{row.direccion}</span><small>Cliente {row.cod_cliente} / Punto {row.nro_lugar_entrega}</small></button>)}</span>}</label>
      <label className="client-onboarding-field"><span>Cliente / punto nuevo</span><span className="client-onboarding-route-target"><input inputMode="numeric" value={targetClient} onFocus={event => event.currentTarget.select()} onChange={event => { setTargetClient(event.target.value.replace(/\D/g, "").slice(0, 4)); setPreview(null) }} /><i>/</i><input inputMode="numeric" value={targetPoint} onFocus={event => event.currentTarget.select()} onChange={event => { setTargetPoint(event.target.value.replace(/\D/g, "").slice(0, 2)); setPreview(null) }} /></span></label>
      <label className="client-onboarding-field client-onboarding-field--wide"><span>Ruta despues de la referencia</span><select disabled={!reference} value={route ? `${route.cod_ruta}|${route.orden_circuito}` : ""} onChange={event => { const selected = routeOptions.find(option => `${option.cod_ruta}|${option.orden_circuito}` === event.target.value) || null; setRoute(selected); setPreview(null) }}><option value="">Seleccionar</option>{routeOptions.map(option => <option key={`${option.cod_ruta}-${option.orden_circuito}`} value={`${option.cod_ruta}|${option.orden_circuito}`}>{option.cod_ruta} - {option.ruta_descripcion} (orden {option.orden_circuito})</option>)}</select></label>
      <label className="client-onboarding-field"><span>L-Entrega</span><select value={lEntrega} onChange={event => setLEntrega(event.target.value)}><option value="S">S</option><option value="N">N</option></select></label>
      <label className="client-onboarding-field"><span>L-Cobro</span><select value={lCobro} onChange={event => setLCobro(event.target.value)}><option value="S">S</option><option value="N">N</option><option value="B-MP">B-MP</option><option value="BA">BA</option><option value="BC">BC</option></select></label>
    </div>
    <div className={`client-onboarding-route-preview${preview ? " client-onboarding-route-preview--ready" : ""}`}>
      {preview ? `La ruta normalizara ${preview.clientes_a_espaciar} cliente(s) en saltos de 5. La referencia quedara en ${preview.orden_referencia_normalizado}; el nuevo punto se insertara en ${preview.orden_nuevo}.` : "Seleccione una direccion de referencia y una de sus rutas para calcular el orden."}
    </div>
    <footer className="client-onboarding-footer"><span>La renumeracion y la insercion se realizan en una unica transaccion.</span><button type="button" className="fetch-button fetch-button--success" disabled={!preview || saving} onClick={() => void save()}>{saving ? "Asignando..." : "Asignar ruta"}</button></footer>
  </section>
}
