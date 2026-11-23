import { LightingView } from "@/features/lighting/view";
import { requireAdmin } from "@/server/auth/session";

export const metadata = { title: "Đèn" };

export default async function Page() {
  await requireAdmin();
  return <LightingView />;
}
