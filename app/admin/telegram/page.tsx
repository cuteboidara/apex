"use client";

import { useEffect, useState } from "react";

interface BotInfo { username?: string; first_name?: string }
interface Alert {
  id: string;
  status: string;
  createdAt: string;
  signal: { asset: string; rank: string; direction: string } | null;
}
interface TelegramData {
  botInfo: BotInfo | null;
  stats: { today: number; week: number; month: number };
  recentAlerts: Alert[];
}

export default function AdminTelegramPage() {
  const [data, setData] = useState<TelegramData | null>(null);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [sendResult, setSendResult] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    fetch("/api/admin/telegram/broadcast")
      .then(r => r.json())
      .then(setData)
      .finally(() => setLoading(false));
  }, []);

  async function broadcast() {
    if (!message.trim()) return;
    setSending(true);
    setSendResult(null);
    const res = await fetch("/api/admin/telegram/broadcast", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message }),
    });
    const json = await res.json() as { success?: boolean; error?: string };
    setSendResult({ ok: !!json.success, text: json.success ? "Message sent." : (json.error ?? "Failed.") });
    if (json.success) setMessage("");
    setSending(false);
  }

  if (loading) return <div className="text-zinc-500 text-sm">Loading...</div>;

  return (
    <div className="space-y-8 max-w-3xl">
      <div>
        <h1 className="text-xl font-bold text-zinc-100 mb-1">Telegram Control</h1>
        <p className="text-xs text-zinc-500">Bot status, broadcast, and message history</p>
      </div>

      {/* Bot status */}
      <section>
        <h2 className="text-xs font-semibold tracking-widest text-zinc-500 uppercase mb-3">Bot Status</h2>
        <div className="bg-zinc-950 border border-zinc-800 rounded-lg p-5">
          {data?.botInfo ? (
            <div className="flex items-center gap-3">
              <span className="w-2 h-2 rounded-full bg-green-500" />
              <div>
                <p className="text-zinc-100 font-medium">@{data.botInfo.username ?? "APEX Bot"}</p>
                <p className="text-zinc-500 text-xs">{data.botInfo.first_name} · Online</p>
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-3">
              <span className="w-2 h-2 rounded-full bg-red-500" />
              <p className="text-zinc-400 text-sm">Bot offline or not configured</p>
            </div>
          )}

          {data?.stats && (
            <div className="grid grid-cols-3 gap-4 mt-4 border-t border-zinc-800 pt-4">
              <div>
                <p className="text-2xl font-bold text-zinc-100">{data.stats.today}</p>
                <p className="text-xs text-zinc-500">Messages today</p>
              </div>
              <div>
                <p className="text-2xl font-bold text-zinc-100">{data.stats.week}</p>
                <p className="text-xs text-zinc-500">This week</p>
              </div>
              <div>
                <p className="text-2xl font-bold text-zinc-100">{data.stats.month}</p>
                <p className="text-xs text-zinc-500">This month</p>
              </div>
            </div>
          )}
        </div>
      </section>

      {/* Broadcast */}
      <section>
        <h2 className="text-xs font-semibold tracking-widest text-zinc-500 uppercase mb-3">Broadcast Message</h2>
        <div className="bg-zinc-950 border border-zinc-800 rounded-lg p-5 space-y-4">
          <textarea
            value={message}
            onChange={e => setMessage(e.target.value)}
            rows={5}
            placeholder="Enter your message... HTML is supported (e.g. <b>bold</b>, <i>italic</i>)"
            className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-4 py-3 text-sm text-zinc-100 placeholder-zinc-600 resize-none focus:outline-none focus:border-zinc-500"
          />

          {/* Preview */}
          {message.trim() && (
            <div className="border border-zinc-700 rounded-lg p-3">
              <p className="text-xs text-zinc-500 mb-2">Preview</p>
              <div
                className="text-sm text-zinc-300 whitespace-pre-wrap"
                dangerouslySetInnerHTML={{ __html: message }}
              />
            </div>
          )}

          <div className="flex items-center gap-3">
            <button
              onClick={broadcast}
              disabled={sending || !message.trim()}
              className="px-5 py-2 rounded-lg text-sm font-semibold transition-colors disabled:opacity-40"
              style={{ backgroundColor: "#00ff88", color: "#000" }}
            >
              {sending ? "Sending..." : "✈ Send to Channel"}
            </button>
            {sendResult && (
              <span className={`text-sm ${sendResult.ok ? "text-green-400" : "text-red-400"}`}>
                {sendResult.text}
              </span>
            )}
          </div>
        </div>
      </section>

      {/* Recent messages */}
      {(data?.recentAlerts.length ?? 0) > 0 && (
        <section>
          <h2 className="text-xs font-semibold tracking-widest text-zinc-500 uppercase mb-3">Recent Alerts Sent</h2>
          <div className="bg-zinc-950 border border-zinc-800 rounded-lg overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-zinc-800 text-zinc-500 text-xs">
                  <th className="text-left px-4 py-3">Signal</th>
                  <th className="text-left px-4 py-3">Status</th>
                  <th className="text-left px-4 py-3">Sent</th>
                </tr>
              </thead>
              <tbody>
                {data!.recentAlerts.map(a => (
                  <tr key={a.id} className="border-b border-zinc-900 hover:bg-zinc-900/40">
                    <td className="px-4 py-3 text-zinc-300">
                      {a.signal
                        ? `${a.signal.asset} ${a.signal.direction} [${a.signal.rank}]`
                        : "—"}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`text-xs font-medium ${
                        a.status === "SENT" ? "text-green-400" :
                        a.status === "FAILED" ? "text-red-400" : "text-zinc-400"
                      }`}>{a.status}</span>
                    </td>
                    <td className="px-4 py-3 text-zinc-500 text-xs">
                      {new Date(a.createdAt).toLocaleString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
