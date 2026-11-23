import { SettingsView } from "@/features/settings/view";
import { requireAdmin } from "@/server/auth/session";

export const metadata = { title: "Cài đặt" };

export default async function Page() {
  await requireAdmin();
  return <SettingsView />;
}
