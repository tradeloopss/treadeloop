import { getAdmin } from "@/lib/admin/guard"
import { roleCan } from "@/lib/admin/access"
import { logAdminAction } from "@/lib/admin/audit"
import { getImportFile } from "@/lib/admin/metrics"

// Downloads the file a failed import kept. Admin-only, and recorded in the
// audit log since it's a user's data leaving the system.
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const admin = await getAdmin()
  if (!admin || !roleCan(admin.role, { brokers: ["view"] })) return new Response("Not found", { status: 404 })

  const id = Number((await params).id)
  const file = Number.isInteger(id) ? await getImportFile(id) : null
  if (!file?.fileContent) return new Response("Not found", { status: 404 })

  await logAdminAction(admin, "import.download", file.userId, { importId: id, fileName: file.fileName })
  const name = (file.fileName ?? `import-${id}.csv`).replace(/[^\w.-]+/g, "_")
  return new Response(file.fileContent, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Content-Disposition": `attachment; filename="${name}"`,
      "Cache-Control": "no-store",
    },
  })
}
