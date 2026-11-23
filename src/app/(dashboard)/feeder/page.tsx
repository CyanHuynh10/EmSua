import { FeederView } from "@/features/feeder/view";
import { requireAdmin } from "@/server/auth/session";

export const metadata = { title: "Máy cho ăn" };

export default async function Page() {
  await requireAdmin();
  return <FeederView />;
}
