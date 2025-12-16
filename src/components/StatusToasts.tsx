import React from "react"
import NotificationToast from "./NotificationToast"

type StatusToastsProps = {
  statusMessage?: string | null
  infoMessage?: string | null
  errorMessage?: string | null
}

export default function StatusToasts({
  statusMessage,
  infoMessage,
  errorMessage
}: StatusToastsProps) {
  if (!statusMessage && !infoMessage && !errorMessage) {
    return null
  }

  return (
    <div className="notification-toast-wrapper">
      {errorMessage ? <NotificationToast tone="error">{errorMessage}</NotificationToast> : null}
      {!errorMessage && infoMessage ? <NotificationToast tone="info">{infoMessage}</NotificationToast> : null}
      {!errorMessage && !infoMessage && statusMessage ? (
        <NotificationToast tone="success">{statusMessage}</NotificationToast>
      ) : null}
    </div>
  )
}
