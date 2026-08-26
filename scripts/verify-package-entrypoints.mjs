import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'

const packageDirectory = resolve(process.argv[2] ?? '')
const packageJson = JSON.parse(
  readFileSync(resolve(packageDirectory, 'package.json'), 'utf8')
)

const packDirectory = mkdtempSync(join(tmpdir(), 'verify-package-entrypoints-'))
const packResult = spawnSync(
  'npm',
  ['pack', '--json', '--pack-destination', packDirectory, '--silent'],
  {
    cwd: packageDirectory,
    encoding: 'utf8',
  }
)

rmSync(packDirectory, { recursive: true, force: true })

if (packResult.status !== 0) {
  process.stderr.write(packResult.stderr)
  process.exit(packResult.status ?? 1)
}

const [{ files }] = JSON.parse(packResult.stdout)
const packedFiles = new Set(files.map(({ path }) => path))
const entrypoints = new Set()

function collectEntrypoints(value) {
  if (typeof value === 'string') {
    entrypoints.add(value.replace(/^\.\//, ''))
    return
  }

  if (value && typeof value === 'object') {
    Object.values(value).forEach(collectEntrypoints)
  }
}

collectEntrypoints(packageJson.main)
collectEntrypoints(packageJson.module)
collectEntrypoints(packageJson.types)
collectEntrypoints(packageJson['react-native'])
collectEntrypoints(packageJson.source)
collectEntrypoints(packageJson.exports)

const extensions = ['', '.js', '.jsx', '.ts', '.tsx', '.d.ts']
const missingEntrypoints = [...entrypoints].filter(
  (entrypoint) =>
    !extensions.some((extension) => packedFiles.has(`${entrypoint}${extension}`))
)

if (missingEntrypoints.length > 0) {
  console.error(
    `Package ${packageJson.name} is missing published entrypoints:\n${missingEntrypoints
      .map((entrypoint) => `- ${entrypoint}`)
      .join('\n')}`
  )
  process.exit(1)
}

console.log(`Verified ${entrypoints.size} entrypoints for ${packageJson.name}`)
