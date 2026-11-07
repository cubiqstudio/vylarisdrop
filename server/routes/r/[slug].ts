import { abrufen } from '../../utils/abruf'

export default defineEventHandler((event) => abrufen(event, 'inline'))
