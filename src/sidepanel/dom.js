// Focus an element ref on the next frame — used after programmatic text
// changes (command completion, new chat) so the browser has laid out any
// resulting DOM changes before we move focus.
export function focusSoon(ref) {
  requestAnimationFrame(() => ref.current?.focus())
}
