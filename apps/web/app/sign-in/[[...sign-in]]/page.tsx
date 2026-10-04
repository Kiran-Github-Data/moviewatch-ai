import { SignIn } from "@clerk/nextjs";
import { isAuthConfigured } from "@/lib/auth-config";

export default function SignInPage() {
  if (!isAuthConfigured) {
    return (
      <main className="flex min-h-screen items-center justify-center px-6">
        <p className="max-w-sm text-center text-sm text-muted">
          Sign-in isn&apos;t configured yet. Set{" "}
          <code className="rounded bg-white/10 px-1">NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY</code> from
          your Clerk dashboard to enable authentication.
        </p>
      </main>
    );
  }
  return (
    <main className="flex min-h-screen items-center justify-center px-6">
      <SignIn routing="path" path="/sign-in" afterSignInUrl="/" />
    </main>
  );
}
