import { Dashboard } from "@/features/dashboard/view";
import { requireAdmin } from "@/server/auth/session";

export default async function Page() {
  await requireAdmin();
  return <Dashboard />;
}
