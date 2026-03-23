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

interface Subscriber {
  id: string;
  chatId: string;
  username: string | null;
  firstName: string | null;
  lastName: string | null;
  tier: string;
  status: string;
  alertsEnabled: boolean;
  alertAssets: string[];
  alertRanks: string[];
  messageCount: number;
  lastActiveAt: string;
  createdAt: string;
}

interface SubsData {
  subscribers: Subscriber[];
  total: number;
  active: number;
}

export default function AdminTelegramPage() {
  const [data, setData] = useState<TelegramData | null>(null);
  const [subsData, setSubsData] = useState<SubsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [sendResult, setSendResult] = useState<{ ok: boolean; text: string } | null>(null);
  const [tab, setTab] = useState<"overview" | "subscribers">("overview");
  const [dmTarget, setDmTarget] = useState<Subscriber | null>(null);
  const [dmText, setDmText] = useState("");
  const [dmSending, setDmSending] = useState(false);

  useEffect(() => {
    fetch("/api/admin/telegram/broadcast")
      .then(r => r.json())
      .then(setData)
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (tab === "subscribers") {
      fetch("/api/admin/telegram/subscribers")
        .then(r => r.json())
        .then(setSubsData);
    }
  }, [tab]);

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

  async function toggleSubscriber(sub: Subscriber) {
    const newStatus = sub.status === "ACTIVE" ? "SUSPENDED" : "ACTIVE";
    await fetch(`/api/admin/telegram/subscribers/${sub.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: newStatus }),
    });
    setSubsData(prev => prev ? {
      ...prev,
      subscribers: prev.subscribers.map(s => s.id === sub.id ? { ...s, status: newStatus } : s),
      active: newStatus === "ACTIVE" ? prev.active + 1 : prev.active - 1,
    } : prev);
  }

  async function deleteSubscriber(sub: Subscriber) {
    if (!confirm(`Remove @${sub.username ?? sub.chatId} from subscribers?`)) return;
    await fetch(`/api/admin/telegram/subscribers/${sub.id}`, { method: "DELETE" });
    setSubsData(prev => prev ? {
      ...prev,
      subscribers: prev.subscribers.filter(s => s.id !== sub.id),
      total: prev.total - 1,
      active: sub.status === "ACTIVE" ? prev.active - 1 : prev.active,
    } : prev);
  }

  async function sendDm() {
    if (!dmTarget || !dmText.trim()) return;
    setDmSending(true);
    const res = await fetch(`/api/admin/telegram/subscribers/${dmTarget.id}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: dmText }),
    });
    const json = await res.json() as { ok?: boolean };
    if (json.ok) { setDmText(""); setDmTarget(null); }
    setDmSending(false);
  }

  if (loading) return <div className="text-zinc-500 text-sm">Loading...</div>;

  return (
    <div className="space-y-6 max-w-4xl">
      <div>
        <h1 className="text-xl font-bold text-zinc-100 mb-1">Telegram Control</h1>
        <p className="text-xs text-zinc-500">Bot status, subscribers, broadcast, and message history</p>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-zinc-800">
        {(["overview", "subscribers"] as const).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2 text-sm font-medium capitalize transition-colors ${
              tab === t ? "text-zinc-100 border-b-2 border-[#C8A96E]" : "text-zinc-500 hover:text-zinc-300"
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      {tab === "overview" && (
        <>
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
                            a.status === "DELIVERED" || a.status === "SENT" ? "text-green-400" :
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
        </>
      )}

      {tab === "subscribers" && (
        <>
          {/* Stats */}
          {subsData && (
            <div className="grid grid-cols-3 gap-4">
              <div className="bg-zinc-950 border border-zinc-800 rounded-lg p-4">
                <p className="text-2xl font-bold text-zinc-100">{subsData.total}</p>
                <p className="text-xs text-zinc-500 mt-1">Total subscribers</p>
              </div>
              <div className="bg-zinc-950 border border-zinc-800 rounded-lg p-4">
                <p className="text-2xl font-bold text-green-400">{subsData.active}</p>
                <p className="text-xs text-zinc-500 mt-1">Active</p>
              </div>
              <div className="bg-zinc-950 border border-zinc-800 rounded-lg p-4">
                <p className="text-2xl font-bold text-zinc-400">{subsData.total - subsData.active}</p>
                <p className="text-xs text-zinc-500 mt-1">Suspended / Inactive</p>
              </div>
            </div>
          )}

          {/* DM Modal */}
          {dmTarget && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70">
              <div className="bg-zinc-900 border border-zinc-700 rounded-xl p-6 w-full max-w-md space-y-4">
                <h3 className="text-zinc-100 font-semibold">
                  DM @{dmTarget.username ?? dmTarget.chatId}
                </h3>
                <textarea
                  value={dmText}
                  onChange={e => setDmText(e.target.value)}
                  rows={4}
                  placeholder="Message (HTML supported)"
                  className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-100 placeholder-zinc-600 resize-none focus:outline-none"
                />
                <div className="flex gap-3">
                  <button
                    onClick={sendDm}
                    disabled={dmSending || !dmText.trim()}
                    className="px-4 py-2 rounded-lg text-sm font-semibold disabled:opacity-40"
                    style={{ backgroundColor: "#C8A96E", color: "#000" }}
                  >
                    {dmSending ? "Sending..." : "Send"}
                  </button>
                  <button
                    onClick={() => { setDmTarget(null); setDmText(""); }}
                    className="px-4 py-2 rounded-lg text-sm text-zinc-400 hover:text-zinc-200 border border-zinc-700"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Subscriber table */}
          {!subsData ? (
            <div className="text-zinc-500 text-sm">Loading subscribers...</div>
          ) : subsData.subscribers.length === 0 ? (
            <div className="text-zinc-500 text-sm">No subscribers yet. Share your bot link to get started.</div>
          ) : (
            <div className="bg-zinc-950 border border-zinc-800 rounded-lg overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-zinc-800 text-zinc-500 text-xs">
                    <th className="text-left px-4 py-3">User</th>
                    <th className="text-left px-4 py-3">Tier</th>
                    <th className="text-left px-4 py-3">Status</th>
                    <th className="text-left px-4 py-3">Alerts</th>
                    <th className="text-left px-4 py-3">Messages</th>
                    <th className="text-left px-4 py-3">Last Active</th>
                    <th className="text-left px-4 py-3">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {subsData.subscribers.map(sub => (
                    <tr key={sub.id} className="border-b border-zinc-900 hover:bg-zinc-900/40">
                      <td className="px-4 py-3">
                        <p className="text-zinc-200 font-medium">
                          {sub.username ? `@${sub.username}` : `${sub.firstName ?? ""} ${sub.lastName ?? ""}`.trim() || sub.chatId}
                        </p>
                        <p className="text-zinc-600 text-xs">{sub.chatId}</p>
                      </td>
                      <td className="px-4 py-3">
                        <span className={`text-xs font-semibold px-2 py-0.5 rounded ${
                          sub.tier === "PRO" ? "bg-amber-900/40 text-amber-300" : "bg-zinc-800 text-zinc-400"
                        }`}>{sub.tier}</span>
                      </td>
                      <td className="px-4 py-3">
                        <span className={`text-xs font-medium ${
                          sub.status === "ACTIVE" ? "text-green-400" : "text-red-400"
                        }`}>{sub.status}</span>
                      </td>
                      <td className="px-4 py-3 text-zinc-400 text-xs">
                        {sub.alertsEnabled ? (
                          <span>
                            {sub.alertRanks.join(",")}
                            {sub.alertAssets.length > 0 ? ` · ${sub.alertAssets.join(",")}` : " · ALL"}
                          </span>
                        ) : (
                          <span className="text-zinc-600">Off</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-zinc-400 text-xs">{sub.messageCount}</td>
                      <td className="px-4 py-3 text-zinc-500 text-xs">
                        {new Date(sub.lastActiveAt).toLocaleDateString()}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => setDmTarget(sub)}
                            className="text-xs text-zinc-400 hover:text-zinc-100 border border-zinc-700 hover:border-zinc-500 px-2 py-1 rounded"
                          >
                            DM
                          </button>
                          <button
                            onClick={() => toggleSubscriber(sub)}
                            className={`text-xs px-2 py-1 rounded border ${
                              sub.status === "ACTIVE"
                                ? "text-amber-400 border-amber-800 hover:border-amber-600"
                                : "text-green-400 border-green-900 hover:border-green-700"
                            }`}
                          >
                            {sub.status === "ACTIVE" ? "Suspend" : "Activate"}
                          </button>
                          <button
                            onClick={() => deleteSubscriber(sub)}
                            className="text-xs text-red-400 hover:text-red-300 border border-red-900 hover:border-red-700 px-2 py-1 rounded"
                          >
                            Remove
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}
