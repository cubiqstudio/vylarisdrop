import { requireAdmin } from '../../utils/auth'
import { requirePro } from '../../utils/lizenz'

const panel = (
  id: number,
  titel: string,
  x: number,
  y: number,
  w: number,
  ausdruecke: Array<[string, string]>,
  einheit = 'short',
  art = 'timeseries'
) => ({
  id,
  type: art,
  title: titel,
  gridPos: { x, y, w, h: art === 'stat' ? 4 : 8 },
  datasource: { type: 'prometheus', uid: '${DS_PROMETHEUS}' },
  fieldConfig: {
    defaults: { unit: einheit, custom: art === 'timeseries' ? { lineWidth: 2, fillOpacity: 10 } : undefined },
    overrides: []
  },
  options:
    art === 'stat'
      ? { reduceOptions: { calcs: ['lastNotNull'] }, colorMode: 'value', graphMode: 'area' }
      : { legend: { displayMode: 'list', placement: 'bottom' }, tooltip: { mode: 'multi' } },
  targets: ausdruecke.map(([expr, legende], i) => ({ refId: String.fromCharCode(65 + i), expr, legendFormat: legende }))
})

export default defineEventHandler(async (event) => {
  await requireAdmin(event)
  await requirePro('monitoring')
  setResponseHeaders(event, {
    'Content-Type': 'application/json',
    'Content-Disposition': 'attachment; filename="vylariscloud-grafana.json"'
  })
  return {
    __inputs: [
      {
        name: 'DS_PROMETHEUS',
        label: 'Prometheus',
        type: 'datasource',
        pluginId: 'prometheus',
        pluginName: 'Prometheus'
      }
    ],
    title: 'VylarisCloud',
    uid: 'vylariscloud',
    schemaVersion: 39,
    version: 1,
    refresh: '30s',
    time: { from: 'now-6h', to: 'now' },
    tags: ['vylariscloud'],
    panels: [
      panel(1, 'Files', 0, 0, 6, [['vylariscloud_files', '']], 'short', 'stat'),
      panel(2, 'Storage', 6, 0, 6, [['sum(vylariscloud_storage_bytes)', '']], 'bytes', 'stat'),
      panel(3, 'Uploads (24 h)', 12, 0, 6, [['vylariscloud_uploads_24h', '']], 'short', 'stat'),
      panel(
        4,
        'Disk free',
        18,
        0,
        6,
        [['min(vylariscloud_disk_free_bytes / vylariscloud_disk_total_bytes)', '']],
        'percentunit',
        'stat'
      ),
      panel(
        5,
        'Requests per second',
        0,
        4,
        12,
        [['sum by (area) (rate(vylariscloud_http_requests_total[5m]))', '{{area}}']],
        'reqps'
      ),
      panel(
        6,
        'Server errors (5xx) per second',
        12,
        4,
        12,
        [['sum by (node) (rate(vylariscloud_http_requests_total{code="5xx"}[5m]))', '{{node}}']],
        'reqps'
      ),
      panel(
        7,
        'Response time p95',
        0,
        12,
        12,
        [
          [
            'histogram_quantile(0.95, sum by (le, node) (rate(vylariscloud_http_request_duration_seconds_bucket[5m])))',
            '{{node}}'
          ]
        ],
        's'
      ),
      panel(8, 'Memory per node', 12, 12, 12, [['process_resident_memory_bytes', '{{node}}']], 'bytes'),
      panel(9, 'CPU per node', 0, 20, 12, [['rate(process_cpu_seconds_total[5m])', '{{node}}']], 'percentunit'),
      panel(10, 'Background queues', 12, 20, 12, [['vylariscloud_queue_jobs', '{{queue}}']]),
      panel(11, 'Event loop delay p99', 0, 28, 12, [['nodejs_eventloop_lag_p99_seconds', '{{node}}']], 's'),
      panel(12, 'Database size', 12, 28, 12, [['vylariscloud_db_size_bytes', '']], 'bytes')
    ]
  }
})
