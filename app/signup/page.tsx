"use client";

import { useState } from "react";
import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";
import Link from "next/link";

export default function SignUp() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const res = await fetch("/api/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    if (!res.ok) {
      const data = await res.json();
      setError(data.error || "Could not sign up.");
      setBusy(false);
      return;
    }
    // auto sign-in after registering
    await signIn("credentials", { email, password, redirect: false });
    setBusy(false);
    router.push("/");
  }

  return (
    <div className="grid min-h-screen place-items-center px-5" style={{ background: "radial-gradient(60% 40% at 15% 0%, rgba(251,191,36,0.10), transparent 60%), #faf9f7" }}>
      <div className="w-full max-w-sm rounded-2xl border border-stone-200 bg-white p-7 shadow-sm">
        <h1 className="font-serif text-2xl font-semibold text-stone-900">Create your account</h1>
        <p className="mb-6 mt-1 text-sm text-stone-500">It takes a few seconds.</p>
        <form onSubmit={submit} className="space-y-3">
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-stone-600">Email</span>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required
              className="w-full rounded-lg border border-stone-300 px-3 py-2 text-sm outline-none focus:border-amber-600 focus:ring-2 focus:ring-amber-600/20" />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-stone-600">Password (6+ characters)</span>
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={6}
              className="w-full rounded-lg border border-stone-300 px-3 py-2 text-sm outline-none focus:border-amber-600 focus:ring-2 focus:ring-amber-600/20" />
          </label>
          {error && <p className="text-sm text-rose-600">{error}</p>}
          <button disabled={busy} style={{ backgroundImage: "linear-gradient(135deg,#f59e0b,#d97706,#b45309)" }}
            className="w-full rounded-lg py-2.5 text-sm font-semibold text-white disabled:opacity-50">
            {busy ? "Creating…" : "Sign up"}
          </button>
        </form>
        <p className="mt-4 text-center text-sm text-stone-500">
          Have an account? <Link href="/signin" className="font-medium text-amber-700 hover:underline">Sign in</Link>
        </p>
      </div>
    </div>
  );
}