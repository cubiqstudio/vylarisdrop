import { davBehandeln } from '../../utils/davMethoden'

// WebDAV-Wurzel (/dav und /dav/): alle Methoden (PROPFIND, MKCOL, MOVE, COPY, LOCK … inklusive)
export default defineEventHandler((event) => davBehandeln(event))
