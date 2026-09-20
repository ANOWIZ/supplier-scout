import { copyFile, mkdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const source = resolve(root, 'data', 'suppliers.json')
const targetDirectory = resolve(root, 'public')
const target = resolve(targetDirectory, 'suppliers.json')

await mkdir(targetDirectory, { recursive: true })
await copyFile(source, target)
console.log('Supplier snapshot synced to frontend/public/suppliers.json')
