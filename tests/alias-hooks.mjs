// Resolves the app's "@/..." path alias (tsconfig "paths") and extensionless
// relative imports to .ts/.tsx files, the way Next's bundler does.
import fs from "node:fs"
import { fileURLToPath, pathToFileURL } from "node:url"

const ROOT = pathToFileURL(fileURLToPath(new URL("..", import.meta.url))).href.replace(/\/?$/, "/")

function firstFile(base) {
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, `${base}/index.ts`]) {
    try {
      if (fs.statSync(fileURLToPath(candidate)).isFile()) return candidate
    } catch {
      // not this one
    }
  }
  return null
}

export async function resolve(specifier, context, next) {
  if (specifier.startsWith("@/")) {
    const found = firstFile(ROOT + specifier.slice(2))
    if (found) return next(found, context)
  } else if ((specifier.startsWith("./") || specifier.startsWith("../")) && context.parentURL?.startsWith("file:")) {
    const found = firstFile(new URL(specifier, context.parentURL).href)
    if (found) return next(found, context)
  }
  return next(specifier, context)
}
