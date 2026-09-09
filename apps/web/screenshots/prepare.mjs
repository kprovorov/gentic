import {
  cp,
  mkdtemp,
  readFile,
  readdir,
  symlink,
  writeFile,
} from "node:fs/promises"
import { fileURLToPath } from "node:url"
import path from "node:path"
const web = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const repo = path.resolve(web, "../..")
const target = await mkdtemp(path.join(repo, "apps/.capture-"))
await cp(web, target, {
  recursive: true,
  filter: (source) => {
    const relative = path.relative(web, source)
    return !relative
      .split(path.sep)
      .some(
        (part) =>
          ["node_modules", ".next", ".turbo"].includes(part) ||
          part.startsWith(".env")
      )
  },
})
await symlink(
  path.join(web, "node_modules"),
  path.join(target, "node_modules"),
  "dir"
)
await writeFile(
  path.join(target, "app/layout.tsx"),
  'export { default } from "@/screenshots/layout"\n'
)
await writeFile(
  path.join(target, "app/issues/page.tsx"),
  'export { default } from "@/screenshots/view"\n'
)
await writeFile(
  path.join(target, "app/issues/[code]/[[...slug]]/page.tsx"),
  'export { default } from "@/screenshots/view"\n'
)
await writeFile(
  path.join(target, "proxy.ts"),
  'import { NextResponse } from "next/server"\nexport function proxy() { return NextResponse.next() }\n'
)
await writeFile(
  path.join(target, "components/nav-user.tsx"),
  "export function NavUser() { return null }\n"
)
await writeFile(
  path.join(target, "components/realtime-refresh.tsx"),
  "export function RealtimeRefresh() { return null }\n"
)
await writeFile(
  path.join(target, "next.config.ts"),
  `export default { devIndicators: false, turbopack: { root: ${JSON.stringify(repo)} }, transpilePackages: ["@gentic/ui", "@gentic/supabase", "@gentic/validators"] }\n`
)
async function isolate(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name)
    if (entry.isDirectory()) await isolate(file)
    else if (/\.tsx?$/.test(entry.name)) {
      const content = await readFile(file, "utf8")
      if (content.includes('from "@gentic/supabase/client"'))
        await writeFile(
          file,
          content.replaceAll(
            'from "@gentic/supabase/client"',
            'from "@/screenshots/inert-client"'
          )
        )
    }
  }
}
await isolate(path.join(target, "app"))
await isolate(path.join(target, "components"))
console.log(target)
