import { VERSION } from './knoten'
import { EREIGNISSE } from './webhooks'

const datei = {
  type: 'object',
  properties: {
    id: { type: 'string', example: '1234' },
    slug: { type: 'string', example: 'kX9q2Rb' },
    name: { type: 'string', example: 'screenshot.png' },
    mime: { type: 'string', example: 'image/png' },
    type: { type: 'string', enum: ['image', 'video', 'audio', 'text', 'file'] },
    size: { type: 'integer', example: 48213 },
    folder_id: { type: ['integer', 'null'], example: 7 },
    created_at: { type: 'string', format: 'date-time' },
    expires_at: { type: ['string', 'null'], format: 'date-time', example: null },
    max_views: { type: ['integer', 'null'], example: null },
    views: { type: 'integer', example: 12 },
    password_protected: { type: 'boolean' },
    favorite: { type: 'boolean' },
    encrypted: { type: 'boolean' },
    live_photo: { type: 'boolean', description: 'Live Photo: a short video belongs to the image (urls.live_video).' },
    width: { type: ['integer', 'null'], example: 1920 },
    height: { type: ['integer', 'null'], example: 1080 },
    duration_ms: { type: ['integer', 'null'], example: null },
    tags: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'integer', example: 3 },
          name: { type: 'string', example: 'Arbeit' },
          color: { type: 'string', example: '#1e73be' }
        }
      }
    },
    scan: {
      type: 'object',
      properties: {
        status: { type: 'string', enum: ['clean', 'unscanned', 'scanning', 'released', 'infected', 'skipped'] }
      }
    },
    urls: {
      type: 'object',
      properties: {
        page: { type: 'string', example: 'https://cloud.example.com/v/kX9q2Rb' },
        direct: {
          type: 'string',
          example: 'https://cloud.example.com/r/kX9q2Rb.png',
          description:
            'Images: if the owner enabled image resizing, append ?w=, h=, fit=contain|cover, format=webp|avif|jpeg|png|auto and q=1-100 (e.g. ?w=800&format=webp).'
        },
        download: { type: 'string', example: 'https://cloud.example.com/d/kX9q2Rb' },
        raw: { type: 'string', example: 'https://cloud.example.com/raw/kX9q2Rb' },
        thumbnail: { type: 'string', example: 'https://cloud.example.com/t/kX9q2Rb' },
        live_video: {
          type: 'string',
          example: 'https://cloud.example.com/l/kX9q2Rb.mp4',
          description:
            'Only for Live Photos: the video as H.264 MP4 (?original=1 = unchanged original). HEIC images deliver a JPEG on the direct link; download/raw stay HEIC.'
        }
      }
    }
  }
}
const ordner = {
  type: 'object',
  properties: {
    id: { type: 'integer', example: 7 },
    name: { type: 'string', example: 'Screenshots' },
    parent_id: { type: ['integer', 'null'], example: null },
    files: { type: 'integer', example: 128 },
    created_at: { type: 'string', format: 'date-time' },
    team: { type: ['object', 'null'], example: null },
    gallery_url: { type: ['string', 'null'], example: null }
  }
}
const fehler = {
  description: 'Error',
  content: {
    'application/json': {
      schema: { type: 'object', properties: { statusCode: { type: 'integer' }, message: { type: 'string' } } }
    }
  }
}
const idParam = { name: 'id', in: 'path', required: true, schema: { type: 'string' }, description: 'File ID' }
const json = (schema: any) => ({ 'application/json': { schema } })
const op = (o: any) => ({
  ...o,
  responses: {
    ...o.responses,
    401: { $ref: '#/components/responses/Error' },
    403: { $ref: '#/components/responses/Error' },
    429: { $ref: '#/components/responses/Error' }
  }
})

export function openapi(basis: string) {
  return {
    openapi: '3.1.0',
    info: {
      title: 'VylarisCloud API',
      version: VERSION,
      description:
        'Self-hosted file and media hosting. Authenticate with a token from “Upload tools” (Authorization: Bearer vd_…). Each token has permissions: upload, read, manage. 600 requests per minute and token.'
    },
    servers: [{ url: `${basis}/api/v1` }],
    security: [{ token: [] }],
    components: {
      securitySchemes: { token: { type: 'http', scheme: 'bearer', bearerFormat: 'vd_…' } },
      schemas: { File: datei, Folder: ordner },
      responses: { Error: fehler }
    },
    tags: [{ name: 'Account' }, { name: 'Files' }, { name: 'Folders' }],
    paths: {
      '/me': {
        get: op({
          tags: ['Account'],
          summary: 'Current account',
          'x-de': 'Das Konto hinter dem Token: Name, Rolle, Speicher',
          'x-recht': 'read',
          responses: {
            200: {
              description: 'OK',
              content: json({
                type: 'object',
                properties: {
                  id: { type: 'integer', example: 1 },
                  username: { type: 'string', example: 'anna' },
                  email: { type: 'string', example: 'anna@example.com' },
                  role: { type: 'string', enum: ['owner', 'admin', 'user'] },
                  storage: {
                    type: 'object',
                    properties: {
                      used: { type: 'integer', example: 734003200 },
                      quota: { type: ['integer', 'null'], example: 10737418240 },
                      files: { type: 'integer', example: 412 }
                    }
                  }
                }
              })
            }
          }
        })
      },
      '/files': {
        get: op({
          tags: ['Files'],
          summary: 'List files',
          'x-de': 'Dateien auflisten, neueste zuerst',
          'x-recht': 'read',
          parameters: [
            { name: 'page', in: 'query', schema: { type: 'integer', default: 1 } },
            { name: 'per_page', in: 'query', schema: { type: 'integer', default: 50, maximum: 200 } },
            {
              name: 'type',
              in: 'query',
              schema: { type: 'string', enum: ['image', 'video', 'audio', 'text', 'file'] }
            },
            { name: 'folder_id', in: 'query', schema: { type: 'string' }, description: 'Folder ID or "none"' },
            { name: 'tag_id', in: 'query', schema: { type: 'integer' } },
            { name: 'search', in: 'query', schema: { type: 'string' }, description: 'Name or link name' },
            { name: 'favorite', in: 'query', schema: { type: 'boolean' } },
            {
              name: 'sort',
              in: 'query',
              schema: { type: 'string', enum: ['newest', 'oldest', 'largest', 'name', 'views'] }
            }
          ],
          responses: {
            200: {
              description: 'OK',
              content: json({
                type: 'object',
                properties: {
                  total: { type: 'integer', example: 412 },
                  page: { type: 'integer', example: 1 },
                  per_page: { type: 'integer', example: 50 },
                  files: { type: 'array', items: { $ref: '#/components/schemas/File' } }
                }
              })
            }
          }
        }),
        post: op({
          tags: ['Files'],
          summary: 'Upload files',
          'x-de': 'Hochladen (eine oder mehrere Dateien, multipart)',
          'x-recht': 'upload',
          parameters: [
            {
              name: 'x-vd-expires',
              in: 'header',
              schema: { type: 'string' },
              description: 'e.g. 7d, 12h or an ISO date'
            },
            { name: 'x-vd-max-views', in: 'header', schema: { type: 'integer' } },
            { name: 'x-vd-password', in: 'header', schema: { type: 'string' } },
            {
              name: 'x-vd-name-style',
              in: 'header',
              schema: { type: 'string', enum: ['zufall', 'woerter', 'datum', 'original', 'uuid', 'unsichtbar'] }
            },
            { name: 'x-vd-folder', in: 'header', schema: { type: 'integer' } }
          ],
          requestBody: {
            required: true,
            content: {
              'multipart/form-data': {
                schema: { type: 'object', properties: { file: { type: 'string', format: 'binary' } } }
              }
            }
          },
          responses: {
            200: {
              description: 'OK',
              content: json({
                type: 'object',
                properties: { files: { type: 'array', items: { $ref: '#/components/schemas/File' } } }
              })
            },
            413: { $ref: '#/components/responses/Error' }
          }
        })
      },
      '/files/{id}': {
        get: op({
          tags: ['Files'],
          summary: 'Get a file',
          'x-de': 'Eine Datei',
          'x-recht': 'read',
          parameters: [idParam],
          responses: {
            200: { description: 'OK', content: json({ $ref: '#/components/schemas/File' }) },
            404: { $ref: '#/components/responses/Error' }
          }
        }),
        patch: op({
          tags: ['Files'],
          summary: 'Update a file',
          'x-de': 'Ändern — alle Felder optional',
          'x-recht': 'manage',
          parameters: [idParam],
          requestBody: {
            content: json({
              type: 'object',
              properties: {
                name: { type: 'string' },
                slug: { type: 'string' },
                folder_id: { type: ['integer', 'null'] },
                expires: { type: ['string', 'null'], description: '7d, ISO date or null = never' },
                max_views: { type: ['integer', 'null'] },
                password: { type: 'string', description: 'empty string removes it' },
                favorite: { type: 'boolean' },
                tag_ids: { type: 'array', items: { type: 'integer' } }
              }
            })
          },
          responses: {
            200: { description: 'OK', content: json({ $ref: '#/components/schemas/File' }) },
            404: { $ref: '#/components/responses/Error' }
          }
        }),
        delete: op({
          tags: ['Files'],
          summary: 'Move a file to the trash',
          'x-de': 'In den Papierkorb (30 Tage wiederherstellbar)',
          'x-recht': 'manage',
          parameters: [idParam],
          responses: {
            200: {
              description: 'OK',
              content: json({
                type: 'object',
                properties: { ok: { type: 'boolean', example: true }, trashed: { type: 'boolean', example: true } }
              })
            },
            404: { $ref: '#/components/responses/Error' }
          }
        })
      },
      '/files/{id}/stats': {
        get: op({
          tags: ['Files'],
          summary: 'View statistics',
          'x-de': 'Aufrufe pro Tag, Herkunft, Länder',
          'x-recht': 'read',
          parameters: [
            idParam,
            { name: 'days', in: 'query', schema: { type: 'integer', enum: [7, 30, 90], default: 30 } }
          ],
          responses: {
            200: {
              description: 'OK',
              content: json({
                type: 'object',
                properties: {
                  days: {
                    type: 'array',
                    items: {
                      type: 'object',
                      properties: {
                        date: { type: 'string', example: '2026-10-23' },
                        views: { type: 'integer', example: 18 }
                      }
                    }
                  },
                  total: { type: 'integer', example: 96 },
                  all_time: { type: 'integer', example: 240 },
                  sources: {
                    type: 'array',
                    items: {
                      type: 'object',
                      properties: {
                        source: { type: 'string', example: 'Discord' },
                        views: { type: 'integer', example: 54 }
                      }
                    }
                  },
                  countries: {
                    type: 'array',
                    items: {
                      type: 'object',
                      properties: {
                        country: { type: ['string', 'null'], example: 'DE' },
                        views: { type: 'integer', example: 71 }
                      }
                    }
                  }
                }
              })
            }
          }
        })
      },
      '/folders': {
        get: op({
          tags: ['Folders'],
          summary: 'List folders',
          'x-de': 'Alle Ordner (flach, mit parent_id)',
          'x-recht': 'read',
          responses: {
            200: {
              description: 'OK',
              content: json({
                type: 'object',
                properties: { folders: { type: 'array', items: { $ref: '#/components/schemas/Folder' } } }
              })
            }
          }
        }),
        post: op({
          tags: ['Folders'],
          summary: 'Create a folder',
          'x-de': 'Neuen Ordner anlegen',
          'x-recht': 'manage',
          requestBody: {
            required: true,
            content: json({
              type: 'object',
              required: ['name'],
              properties: { name: { type: 'string' }, parent_id: { type: ['integer', 'null'] } }
            })
          },
          responses: { 200: { description: 'OK', content: json({ $ref: '#/components/schemas/Folder' }) } }
        })
      }
    },
    'x-webhooks': {
      events: EREIGNISSE,
      headers: {
        'X-VylarisCloud-Event': 'event name',
        'X-VylarisCloud-Delivery': 'delivery ID (same on retries)',
        'X-VylarisCloud-Signature': 't=<unix time>,v1=<hex HMAC-SHA256(secret, "<t>.<raw body>")>'
      },
      retries: 'up to 5 attempts: after 1 min, 5 min, 30 min, 2 h; disabled after 20 failures in a row'
    }
  }
}
