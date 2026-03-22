"use client";

import { useState, FormEvent } from "react";
import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";
import Link from "next/link";

export default function SignUpPage() {
  const router = useRouter();

  const [name, setName]               = useState("");
  const [email, setEmail]             = useState("");
  const [password, setPassword]       = useState("");
  const [confirm, setConfirm]         = useState("");
  const [error, setError]             = useState("");
  const [loading, setLoading]         = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");

    if (password !== confirm) {
      setError("Passwords do not match.");
      return;
    }
    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }

    setLoading(true);

    // Create account
    const res = await fetch("/api/auth/signup", {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ name: name.trim(), email: email.trim(), password }),
    });

    if (!res.ok) {
      const data = await res.json() as { error?: string };
      setLoading(false);
      setError(data.error ?? "Sign up failed. Please try again.");
      return;
    }

    // Auto sign-in after account creation
    const result = await signIn("credentials", {
      email:    email.trim(),
      password,
      redirect: false,
    });

    setLoading(false);

    if (result?.error) {
      setError("Account created but sign-in failed. Please sign in manually.");
      router.push("/auth/signin");
      return;
    }

    router.push("/");
    router.refresh();
  }

  return (
    <div className="min-h-screen bg-black flex items-center justify-center px-4">
      <div className="w-full max-w-sm">

        {/* Logo */}
        <div className="flex flex-col items-center mb-8">
          <div className="w-10 h-10 rounded-xl bg-green-500/10 border border-green-500/30 flex items-center justify-center mb-4">
            <div className="w-4 h-4 rounded-sm bg-green-400" />
          </div>
          <h1 className="text-lg font-black tracking-[0.28em] uppercase text-white">APEX</h1>
          <p className="text-[9px] text-green-400 tracking-[0.3em] uppercase mt-0.5">Institutional Signal Operations</p>
        </div>

        {/* Card */}
        <div className="bg-[#0a0a0a] border border-zinc-900 rounded-2xl p-7">
          <h2 className="text-sm font-bold tracking-widest uppercase text-white mb-1">Create Account</h2>
          <p className="text-[11px] text-zinc-500 mb-6">Set up your APEX access credentials.</p>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-[10px] font-bold tracking-widest uppercase text-zinc-500 mb-1.5">
                Name
              </label>
              <input
                type="text"
                autoComplete="name"
                required
                value={name}
                onChange={e => setName(e.target.value)}
                className="w-full bg-black border border-zinc-800 rounded-lg px-3 py-2.5 text-sm text-white placeholder-zinc-700 focus:outline-none focus:border-green-500/50 focus:ring-1 focus:ring-green-500/20 transition-colors"
                placeholder="Your name"
              />
            </div>

            <div>
              <label className="block text-[10px] font-bold tracking-widest uppercase text-zinc-500 mb-1.5">
                Email
              </label>
              <input
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={e => setEmail(e.target.value)}
                className="w-full bg-black border border-zinc-800 rounded-lg px-3 py-2.5 text-sm text-white placeholder-zinc-700 focus:outline-none focus:border-green-500/50 focus:ring-1 focus:ring-green-500/20 transition-colors"
                placeholder="you@example.com"
              />
            </div>

            <div>
              <label className="block text-[10px] font-bold tracking-widest uppercase text-zinc-500 mb-1.5">
                Password
              </label>
              <input
                type="password"
                autoComplete="new-password"
                required
                value={password}
                onChange={e => setPassword(e.target.value)}
                className="w-full bg-black border border-zinc-800 rounded-lg px-3 py-2.5 text-sm text-white placeholder-zinc-700 focus:outline-none focus:border-green-500/50 focus:ring-1 focus:ring-green-500/20 transition-colors"
                placeholder="Min. 8 characters"
              />
            </div>

            <div>
              <label className="block text-[10px] font-bold tracking-widest uppercase text-zinc-500 mb-1.5">
                Confirm Password
              </label>
              <input
                type="password"
                autoComplete="new-password"
                required
                value={confirm}
                onChange={e => setConfirm(e.target.value)}
                className="w-full bg-black border border-zinc-800 rounded-lg px-3 py-2.5 text-sm text-white placeholder-zinc-700 focus:outline-none focus:border-green-500/50 focus:ring-1 focus:ring-green-500/20 transition-colors"
                placeholder="••••••••"
              />
            </div>

            {error && (
              <p className="text-[11px] text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-green-600 hover:bg-green-500 disabled:opacity-50 disabled:cursor-not-allowed text-white text-[11px] font-bold tracking-widest uppercase py-2.5 rounded-lg transition-colors mt-2"
            >
              {loading ? "Creating account…" : "Create Account"}
            </button>
          </form>
        </div>

        <p className="text-center text-[11px] text-zinc-600 mt-5">
          Already have an account?{" "}
          <Link href="/auth/signin" className="text-green-400 hover:text-green-300 transition-colors">
            Sign in
          </Link>
        </p>
      </div>
    </div>
  );
}
