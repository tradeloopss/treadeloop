"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { PnlCardFlow } from "@/components/pnl-cards/flow"
import { useT } from "@/components/locale-provider"
import { Award } from "lucide-react"

// The dashboard's P&L certificate. It is a PNL Card in the certificate's own
// design (components/pnl-cards/certificate.tsx), made the way any card is: the
// trader picks which accounts and which period, then what shows on it and who
// may open it. Its figures are worked out on the server from the accounts that
// are theirs; all this is given is the names to choose from.
export function PnlCertificateButton({ accounts }: { accounts: { id: number; name: string }[] }) {
  const t = useT()
  const [open, setOpen] = useState(false)
  return (
    <>
      <Button variant="outline" onClick={() => accounts.length > 0 && setOpen(true)} disabled={accounts.length === 0}>
        <Award className="size-4" /> {t("P&L Certificate")}
      </Button>
      {open && <PnlCardFlow design="certificate" scope={{ kind: "all" }} accounts={accounts} onClose={() => setOpen(false)} />}
    </>
  )
}
