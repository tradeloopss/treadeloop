import { listCsvSchemas } from "@/app/actions/settings-lists"
import { CsvSchemasView } from "@/components/settings/pages/csv-schemas-view"

export const metadata = { title: "CSV Schemas" }

export default async function CsvSchemasSettingsPage() {
  const schemas = await listCsvSchemas()
  return <CsvSchemasView initial={schemas} />
}
