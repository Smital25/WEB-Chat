"use client";

import { useState } from "react";
import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";
import Link from "next/link";

export default function SignIn() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const res = await signIn("credentials", { email, password, redirect: false });
    setBusy(false);
    if (res?.error) setError("Wrong email or password.");
    else router.push("/");
  }

  return <AuthShell title="Welcome back" subtitle="Sign in to continue.">
    <form onSubmit={submit} className="space-y-3">
      <Field label="Email" type="email" value={email} onChange={setEmail} />
      <Field label="Password" type="password" value={password} onChange={setPassword} />
      {error && <p className="text-sm text-rose-600">{error}</p>}
      <button disabled={busy} className="ec-mark w-full rounded-lg py-2.5 text-sm font-semibold text-white disabled:opacity-50">
        {busy ? "Signing in…" : "Sign in"}
      </button>
    </form>
    <p className="mt-4 text-center text-sm text-stone-500">
      No account? <Link href="/signup" className="font-medium text-amber-700 hover:underline">Sign up</Link>
    </p>
  </AuthShell>;
}

function AuthShell({ title, subtitle, children }: { title: string; subtitle: string; children: React.ReactNode }) {
  return (
    <div className="grid min-h-screen place-items-center px-5" style={{ background: "radial-gradient(60% 40% at 15% 0%, rgba(251,191,36,0.10), transparent 60%), #faf9f7" }}>
      <div className="w-full max-w-sm rounded-2xl border border-stone-200 bg-white p-7 shadow-sm">
        <h1 className="font-serif text-2xl font-semibold text-stone-900">{title}</h1>
        <p className="mb-6 mt-1 text-sm text-stone-500">{subtitle}</p>
        {children}
      </div>
      <style>{`.ec-mark{background-image:linear-gradient(135deg,#f59e0b,#d97706,#b45309);}`}</style>
    </div>
  );
}

function Field({ label, type, value, onChange }: { label: string; type: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-stone-600">{label}</span>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        required
        className="w-full rounded-lg border border-stone-300 px-3 py-2 text-sm outline-none focus:border-amber-600 focus:ring-2 focus:ring-amber-600/20"
      />
    </label>
  );
}