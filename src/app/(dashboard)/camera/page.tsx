import { CameraView } from "@/features/camera/view";
import { requireAdmin } from "@/server/auth/session";

export const metadata = { title: "Camera" };

export default async function Page() {
  await requireAdmin();
  return <CameraView />;
}
