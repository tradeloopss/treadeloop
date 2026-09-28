import { getUserSettings } from "@/app/actions/settings"
import { OrderGroupingView } from "@/components/settings/pages/order-grouping-view"

export const metadata = { title: "Order Grouping" }

export default async function OrderGroupingSettingsPage() {
  const s = await getUserSettings()
  return <OrderGroupingView initial={s.orderGrouping} />
}
