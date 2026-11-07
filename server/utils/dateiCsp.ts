const MEDIEN =
  /^(video|audio)\/|^image\/(png|jpe?g|gif|webp|avif|bmp|heic|heif|tiff|x-icon|vnd\.microsoft\.icon)\b|^application\/pdf\b/i
const GRUND = "default-src 'none'; img-src 'self' data:; media-src 'self'; style-src 'unsafe-inline'"
export const dateiCsp = (typ: string) => (MEDIEN.test(typ) ? GRUND : `sandbox; ${GRUND}`)
