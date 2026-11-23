import { requireAdmin } from "@/server/auth/session";
import { Shell } from "@/components/layout/shell";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  await requireAdmin();
  return <Shell>{children}</Shell>;
}
