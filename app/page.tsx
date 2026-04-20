import Link from "next/link";

export default function Home() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-950 px-6 text-white">
      <div className="w-full max-w-5xl text-center">
        <h1 className="font-mono text-3xl font-bold">APEX</h1>
        <p className="mb-12 mt-2 font-mono text-sm text-slate-500">Choose your mode</p>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <Link
            href="/indices-v2"
            className="rounded-xl border border-blue-500/30 bg-blue-500/5 p-6 text-left transition-colors hover:bg-blue-500/10"
          >
            <div className="mb-1 font-mono text-lg font-bold text-white">Swing</div>
            <div className="mb-3 font-mono text-xs text-slate-400">AMT · 4H · 3-10 days</div>
            <div className="font-mono text-[10px] text-blue-400">Open -&gt;</div>
          </Link>

          <Link
            href="/sniper"
            className="rounded-xl border border-red-500/30 bg-red-500/5 p-6 text-left transition-colors hover:bg-red-500/10"
          >
            <div className="mb-1 font-mono text-lg font-bold text-white">Sniper</div>
            <div className="mb-3 font-mono text-xs text-slate-400">Liquidity sweeps · 15m · 1-48h</div>
            <div className="font-mono text-[10px] text-red-400">Open -&gt;</div>
          </Link>

          <Link
            href="/scalp"
            className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-6 text-left transition-colors hover:bg-amber-500/10"
          >
            <div className="mb-1 font-mono text-lg font-bold text-white">Scalp</div>
            <div className="mb-3 font-mono text-xs text-slate-400">5-Gate · 15m · 1-4h</div>
            <div className="font-mono text-[10px] text-amber-400">Open -&gt;</div>
          </Link>
        </div>
      </div>
    </div>
  );
}
