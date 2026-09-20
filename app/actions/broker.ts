"use server"

import { auth } from "@/lib/auth"
import { headers } from "next/headers"
import { revalidatePath } from "next/cache"
import { importCsvText, logImport } from "@/lib/trade-importer"

async function getUserId() {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) throw new Error("Unauthorized")
  return session.user.id
}

export async function importTradeCsv(formData: FormData) {
  const userId = await getUserId()
  const file = formData.get("file") as File | null
  if (!file || file.size === 0) throw new Error("Choose a CSV file first")

  const accountIdRaw = formData.get("accountId")
  const fixedAccountId = accountIdRaw && String(accountIdRaw) !== "" ? Number(accountIdRaw) : null

  // Only used when this import creates a new account (auto mode); ignored when
  // filing into an account that already has a balance.
  const startingBalanceRaw = formData.get("startingBalance")
  const startingBalance =
    fixedAccountId == null && startingBalanceRaw != null && String(startingBalanceRaw).trim() !== "" ? Number(startingBalanceRaw) : null
  const newAccountStartingBalance = startingBalance != null && Number.isFinite(startingBalance) && startingBalance > 0 ? startingBalance : null

  const csvText = await file.text()
  // Every attempt is logged (lib/trade-importer.ts), failures with the file,
  // so a broker changing its export format shows up in the admin panel.
  let result
  try {
    result = await importCsvText(userId, csvText, fixedAccountId, newAccountStartingBalance)
  } catch (err) {
    await logImport({ userId, fileName: file.name, csvText, accountId: fixedAccountId, error: err })
    throw err
  }
  await logImport({ userId, fileName: file.name, csvText, accountId: fixedAccountId, result })

  revalidatePath("/dashboard")
  revalidatePath("/trades")
  revalidatePath("/journal")
  revalidatePath("/calendar")
  revalidatePath("/reports")
  revalidatePath("/settings")

  return result
}
