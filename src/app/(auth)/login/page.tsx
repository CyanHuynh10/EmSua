import { redirect } from "next/navigation";
import { signedIn } from "@/server/auth/session";
import { LoginForm } from "@/features/login-form";

export const metadata = { title: "Đăng nhập" };

export default async function LoginPage() {
  if (await signedIn()) redirect("/");
  return <LoginForm />;
}
