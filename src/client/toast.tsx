// A minimal toast: one short message at a time, with an optional action.

import { useSyncExternalStore } from 'react'

interface Toast { id: number; message: string; action?: { label: string; run: () => void } }

let current: Toast | null = null
let seq = 0
let timer: ReturnType<typeof setTimeout> | undefined
const listeners = new Set<() => void>()

function emit(): void {
  for (const l of listeners) l()
}

export function showToast(message: string, action?: Toast['action'], ms = 5000): void {
  current = action ? { id: ++seq, message, action } : { id: ++seq, message }
  clearTimeout(timer)
  timer = setTimeout(dismissToast, ms)
  emit()
}

export function dismissToast(): void {
  current = null
  emit()
}

function subscribe(l: () => void): () => void {
  listeners.add(l)
  return () => listeners.delete(l)
}

export function Toaster() {
  const toast = useSyncExternalStore(subscribe, () => current)
  return (
    <div className="toast-region" role="status" aria-live="polite">
      {toast && (
        <div className="toast" key={toast.id}>
          <span>{toast.message}</span>
          {toast.action && (
            <button type="button" onClick={() => { toast.action!.run(); dismissToast() }}>{toast.action.label}</button>
          )}
        </div>
      )}
    </div>
  )
}
