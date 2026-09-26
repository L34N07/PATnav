import React, { useEffect, useRef, useState } from "react"

export const formatSpanishDate = (value: string) => {
  const match = String(value || "").match(/^(\d{4})-(\d{2})-(\d{2})$/)
  return match ? `${match[3]}/${match[2]}/${match[1]}` : value
}

const formatTypedSpanishDate = (value: string) => {
  const digits = String(value || "").replace(/\D/g, "").slice(0, 8)
  if (digits.length <= 2) {
    return digits
  }
  if (digits.length <= 4) {
    return `${digits.slice(0, 2)}/${digits.slice(2)}`
  }
  return `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4)}`
}

const spanishDateToIso = (value: string) => {
  const match = String(value || "").match(/^(\d{2})\/(\d{2})\/(\d{4})$/)
  if (!match) {
    return null
  }

  const day = Number(match[1])
  const month = Number(match[2])
  const year = Number(match[3])
  const date = new Date(Date.UTC(year, month - 1, day))
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null
  }
  return `${match[3]}-${match[2]}-${match[1]}`
}

type SpanishDateInputProps = {
  value: string
  onChange: (value: string) => void
  ariaLabel: string
  disabled?: boolean
  className?: string
}

export default function SpanishDateInput({
  value,
  onChange,
  ariaLabel,
  disabled = false,
  className = ""
}: SpanishDateInputProps) {
  const [display, setDisplay] = useState(() => formatSpanishDate(value))
  const pickerRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    setDisplay(formatSpanishDate(value))
  }, [value])

  const commitDisplay = (nextDisplay: string) => {
    const isoDate = spanishDateToIso(nextDisplay)
    if (!isoDate) {
      setDisplay(formatSpanishDate(value))
      return
    }
    setDisplay(formatSpanishDate(isoDate))
    onChange(isoDate)
  }

  return (
    <span className={`patnav-date-control ${className}`.trim()}>
      <input
        className="patnav-date-input"
        inputMode="numeric"
        placeholder="DD/MM/AAAA"
        value={display}
        disabled={disabled}
        onChange={event => {
          const nextDisplay = formatTypedSpanishDate(event.target.value)
          setDisplay(nextDisplay)
          const isoDate = spanishDateToIso(nextDisplay)
          if (isoDate) {
            onChange(isoDate)
          }
        }}
        onFocus={event => event.currentTarget.select()}
        onBlur={() => commitDisplay(display)}
      />
      <button
        className="patnav-date-picker-button"
        type="button"
        aria-label={`Abrir calendario para ${ariaLabel}`}
        disabled={disabled}
        onClick={() => {
          const picker = pickerRef.current
          if (!picker) return
          try {
            picker.showPicker()
          } catch {
            picker.focus()
            picker.click()
          }
        }}
      >
        <span aria-hidden="true" />
      </button>
      <input
        ref={pickerRef}
        className="patnav-date-picker-native"
        type="date"
        value={value}
        disabled={disabled}
        onChange={event => onChange(event.target.value)}
        tabIndex={-1}
        aria-hidden="true"
      />
    </span>
  )
}
