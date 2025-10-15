import React from "react"
import NotificationToast from "./NotificationToast"

type StatusToastsProps = {
  statusMessage?: string | null
  errorMessage?: string | null
}

export default function StatusToasts({
  statusMessage,
  errorMessage
}: StatusToastsProps) {
  if (!statusMessage && !errorMessage) {
    return null
  }

  return (
    <div className="notification-toast-wrapper">
      {errorMessage ? (
        <NotificationToast tone="error">{errorMessage}</NotificationToast>
      ) : null}
      {!errorMessage && statusMessage ? (
        <NotificationToast tone="success">{statusMessage}</NotificationToast>
      ) : null}
    </div>
  )
}

