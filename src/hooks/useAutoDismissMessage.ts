import { Dispatch, SetStateAction, useEffect } from "react"

const DEFAULT_DELAY_MS = 3000

export function useAutoDismissMessage(
  message: string | null,
  setMessage: Dispatch<SetStateAction<string | null>>,
  delayMs: number = DEFAULT_DELAY_MS
) {
  useEffect(() => {
    if (!message) {
      return
    }

    const timeoutId = window.setTimeout(() => {
      setMessage(null)
    }, delayMs)

    return () => {
      window.clearTimeout(timeoutId)
    }
  }, [message, setMessage, delayMs])
}
