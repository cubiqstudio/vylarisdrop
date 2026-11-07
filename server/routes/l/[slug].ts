import { nebenAbrufen } from '../../utils/abruf'

export default defineEventHandler((event) => nebenAbrufen(event, 'live'))
