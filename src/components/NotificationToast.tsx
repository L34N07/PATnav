import React from "react"

type NotificationTone = "success" | "error" | "info"

type NotificationToastProps = {
  children: React.ReactNode
  tone?: NotificationTone
}

export default function NotificationToast({
  children,
  tone = "success"
}: NotificationToastProps) {
  const role = tone === "error" ? "alert" : "status"
  const className = `notification-toast notification-toast--${tone}`

  return (
    <div className={className} role={role} aria-live="polite">
      {children}
    </div>
  )
}
