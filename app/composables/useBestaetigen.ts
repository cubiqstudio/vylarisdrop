export interface Bestaetigung {
  titel: string
  text: string
  knopf: string
  aktion: () => Promise<void> | void
  laeuft?: boolean
}
export const useBestaetigung = () => useState<Bestaetigung | null>('bestaetigung', () => null)
export function useBestaetigen() {
  const b = useBestaetigung()
  return (titel: string, text: string, knopf: string, aktion: () => Promise<void> | void) => {
    b.value = { titel, text, knopf, aktion }
  }
}
