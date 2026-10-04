import { isAuthConfigured } from "@/lib/auth-config";
import { LandingNoAuth, LandingWithAuth } from "@/components/landing";

export default function Home() {
  if (!isAuthConfigured) return <LandingNoAuth />;
  return <LandingWithAuth />;
}
