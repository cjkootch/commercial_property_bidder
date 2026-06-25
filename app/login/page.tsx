import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { OPERATOR_COOKIE, operatorSecret } from "@/lib/auth";

export const dynamic = "force-dynamic";

async function login(formData: FormData) {
  "use server";
  const secret = operatorSecret();
  const from = (formData.get("from") as string) || "/dashboard";

  // Auth disabled (no secret configured): go straight in.
  if (!secret) redirect(from);

  const provided = (formData.get("secret") as string) ?? "";
  if (provided === secret) {
    cookies().set(OPERATOR_COOKIE, secret, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 60 * 60 * 24 * 30,
    });
    redirect(from);
  }
  redirect(`/login?error=1&from=${encodeURIComponent(from)}`);
}

export default function LoginPage({
  searchParams,
}: {
  searchParams: { error?: string; from?: string };
}) {
  return (
    <div className="mx-auto max-w-sm pt-12">
      <h1 className="text-xl font-semibold">Operator sign-in</h1>
      <p className="mt-1 text-sm text-gray-500">
        Enter the shared operator secret to continue.
      </p>
      <form action={login} className="mt-6 space-y-4">
        <input type="hidden" name="from" value={searchParams.from ?? "/dashboard"} />
        <input
          type="password"
          name="secret"
          autoFocus
          placeholder="Operator secret"
          className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-brand focus:outline-none"
        />
        {searchParams.error ? (
          <p className="text-sm text-red-600">Incorrect secret. Try again.</p>
        ) : null}
        <button
          type="submit"
          className="w-full rounded-md bg-brand px-3 py-2 text-sm font-medium text-white hover:bg-brand-dark"
        >
          Sign in
        </button>
      </form>
    </div>
  );
}
