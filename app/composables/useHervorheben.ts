const ENDUNG: Record<string, string> = {
  js: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  jsx: 'javascript',
  ts: 'typescript',
  tsx: 'typescript',
  vue: 'xml',
  html: 'xml',
  htm: 'xml',
  xml: 'xml',
  svg: 'xml',
  css: 'css',
  scss: 'scss',
  less: 'less',
  json: 'json',
  yml: 'yaml',
  yaml: 'yaml',
  toml: 'ini',
  ini: 'ini',
  conf: 'ini',
  env: 'bash',
  py: 'python',
  rb: 'ruby',
  php: 'php',
  go: 'go',
  rs: 'rust',
  java: 'java',
  kt: 'kotlin',
  c: 'c',
  h: 'c',
  cpp: 'cpp',
  hpp: 'cpp',
  cs: 'csharp',
  swift: 'swift',
  sh: 'bash',
  bash: 'bash',
  zsh: 'bash',
  ps1: 'powershell',
  bat: 'dos',
  sql: 'sql',
  lua: 'lua',
  r: 'r',
  dart: 'dart',
  md: 'markdown',
  markdown: 'markdown',
  diff: 'diff',
  patch: 'diff',
  dockerfile: 'dockerfile',
  gradle: 'gradle',
  properties: 'properties',
  log: 'plaintext',
  txt: 'plaintext',
  csv: 'plaintext'
}
export const SPRACHEN: Array<{ v: string; name: string; ext: string }> = [
  { v: 'plaintext', name: 'Text', ext: 'txt' },
  { v: 'markdown', name: 'Markdown', ext: 'md' },
  { v: 'javascript', name: 'JavaScript', ext: 'js' },
  { v: 'typescript', name: 'TypeScript', ext: 'ts' },
  { v: 'json', name: 'JSON', ext: 'json' },
  { v: 'xml', name: 'HTML / XML', ext: 'html' },
  { v: 'css', name: 'CSS', ext: 'css' },
  { v: 'python', name: 'Python', ext: 'py' },
  { v: 'php', name: 'PHP', ext: 'php' },
  { v: 'java', name: 'Java', ext: 'java' },
  { v: 'csharp', name: 'C#', ext: 'cs' },
  { v: 'cpp', name: 'C++', ext: 'cpp' },
  { v: 'go', name: 'Go', ext: 'go' },
  { v: 'rust', name: 'Rust', ext: 'rs' },
  { v: 'bash', name: 'Shell', ext: 'sh' },
  { v: 'powershell', name: 'PowerShell', ext: 'ps1' },
  { v: 'sql', name: 'SQL', ext: 'sql' },
  { v: 'yaml', name: 'YAML', ext: 'yml' },
  { v: 'ini', name: 'INI / TOML', ext: 'ini' },
  { v: 'dockerfile', name: 'Dockerfile', ext: 'dockerfile' },
  { v: 'diff', name: 'Diff', ext: 'diff' },
  { v: 'lua', name: 'Lua', ext: 'lua' }
]
export const spracheAusName = (name: string) =>
  ENDUNG[/\.([a-z0-9]{1,12})$/i.exec(name)?.[1] || name.toLowerCase()] || ''

let hljs: any = null
const escapen = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

export async function hervorheben(text: string, sprache: string): Promise<{ html: string; sprache: string }> {
  if (!import.meta.client) return { html: escapen(text), sprache }
  if (text.length > 400_000) return { html: escapen(text), sprache: 'plaintext' }
  if (!hljs) hljs = (await import('highlight.js/lib/common')).default
  try {
    if (sprache && sprache !== 'auto' && hljs.getLanguage(sprache))
      return { html: hljs.highlight(text, { language: sprache, ignoreIllegals: true }).value, sprache }
    if (sprache === 'plaintext') return { html: escapen(text), sprache }
    const r = hljs.highlightAuto(text.slice(0, 60_000))
    return text.length <= 60_000
      ? { html: r.value, sprache: r.language || 'plaintext' }
      : {
          html: hljs.highlight(text, { language: r.language || 'plaintext', ignoreIllegals: true }).value,
          sprache: r.language || 'plaintext'
        }
  } catch {
    return { html: escapen(text), sprache: 'plaintext' }
  }
}
