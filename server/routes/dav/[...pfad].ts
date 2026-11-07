import { davBehandeln } from '../../utils/davMethoden'

// WebDAV-Baum unter /dav/…: alle Methoden
export default defineEventHandler((event) => davBehandeln(event))
