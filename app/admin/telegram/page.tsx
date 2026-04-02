"use client";

import { useEffect, useState } from "react";

import { fetchJsonResponse, formatApiError } from "@/lib/http/fetchJson";

interface BotInfo {
  username?: string;
  first_name?: string;
}

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
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [sendResult, setSendResult] = useState<{ ok: boolean; text: string } | null>(null);
  const [tab, setTab] = useState<"overview" | "subscribers">("overview");
  const [dmTarget, setDmTarget] = useState<Subscriber | null>(null);
  const [dmText, setDmText] = useState("");
  const [dmSending, setDmSending] = useState(false);

  useEffect(() => {
    const loadOverview = async () => {
      setLoading(true);
      setError(null);
      const result = await fetchJsonResponse<TelegramData>("/api/admin/telegram/broadcast");
      if (result.ok && result.data) {
        setData(result.data);
      } else {
        setData(null);
        setError(formatApiError(result, "Failed to load Telegram overview."));
      }
      setLoading(false);
    };

    void loadOverview();
  }, []);

  useEffect(() => {
    if (tab === "subscribers") {
      const loadSubscribers = async () => {
        const result = await fetchJsonResponse<SubsData>("/api/admin/telegram/subscribers");
        if (result.ok && result.data) {
          setSubsData(result.data);
        } else {
          setSubsData(null);
          setError(formatApiError(result, "Failed to load Telegram subscribers."));
        }
      };

      void loadSubscribers();
    }
  }, [tab]);

  async function broadcast() {
    if (!message.trim()) return;
    setSending(true);
    setSendResult(null);
    const result = await fetchJsonResponse<{ success?: boolean; error?: string; message?: string }>("/api/admin/telegram/broadcast", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message }),
    });
    const payload = result.data;
    const success = Boolean(payload?.success);
    setSendResult({ ok: success, text: success ? "Message sent." : formatApiError(result, "Failed.") });
    if (success) setMessage("");
    setSending(false);
  }

  async function toggleSubscriber(subscriber: Subscriber) {
    const newStatus = subscriber.status === "ACTIVE" ? "SUSPENDED" : "ACTIVE";
    await fetch(`/api/admin/telegram/subscribers/${subscriber.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: newStatus }),
    });
    setSubsData(prev => prev ? {
      ...prev,
      subscribers: prev.subscribers.map(item => item.id === subscriber.id ? { ...item, status: newStatus } : item),
      active: newStatus === "ACTIVE" ? prev.active + 1 : prev.active - 1,
    } : prev);
  }

  async function deleteSubscriber(subscriber: Subscriber) {
    if (!confirm(`Remove @${subscriber.username ?? subscriber.chatId} from subscribers?`)) return;
    await fetch(`/api/admin/telegram/subscribers/${subscriber.id}`, { method: "DELETE" });
    setSubsData(prev => prev ? {
      ...prev,
      subscribers: prev.subscribers.filter(item => item.id !== subscriber.id),
      total: prev.total - 1,
      active: subscriber.status === "ACTIVE" ? prev.active - 1 : prev.active,
    } : prev);
  }

  async function sendDm() {
    if (!dmTarget || !dmText.trim()) return;
    setDmSending(true);
    const result = await fetchJsonResponse<{ ok?: boolean }>(`/api/admin/telegram/subscribers/${dmTarget.id}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: dmText }),
    });
    if (result.data?.ok) {
      setDmText("");
      setDmTarget(null);
    }
    setDmSending(false);
  }

  if (loading) return <div className="apex-empty-state">Loading Telegram control…</div>;
  if (error && !data && tab === "overview") {
    return (
      <div className="apex-stack-card border-[var(--apex-status-blocked-border)] bg-[var(--apex-status-blocked-bg)] text-sm text-[var(--apex-status-blocked-text)]">
        {error}
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-6xl">
      <section className="apex-surface px-6 py-6">
        <p className="apex-eyebrow">Notifications Control</p>
        <h2 className="mt-3 font-[var(--apex-font-display)] text-[28px] font-semibold tracking-[-0.05em] text-[var(--apex-text-primary)]">
          Telegram delivery operations
        </h2>
        <p className="mt-3 text-[14px] leading-7 text-[var(--apex-text-secondary)]">
          Bot status, operator broadcast controls, subscriber visibility, and recent alert delivery history.
        </p>
      </section>

      <div className="apex-tab-row">
        {(["overview", "subscribers"] as const).map(item => (
          <button key={item} onClick={() => setTab(item)} data-active={tab === item} className="apex-tab-button">
            {item}
          </button>
        ))}
      </div>

      {tab === "overview" ? (
        <>
          <div className="apex-admin-kpi-grid">
            <div className="apex-admin-kpi">
              <p className="apex-admin-kpi-label">Bot</p>
              <p className="mt-4 text-[17px] font-semibold text-[var(--apex-text-primary)]">
                {data?.botInfo ? `@${data.botInfo.username ?? "APEXatis_bot"}` : "Offline"}
              </p>
              <p className="apex-admin-kpi-detail">{data?.botInfo ? `${data.botInfo.first_name} · Online` : "Bot offline or not configured"}</p>
            </div>
            <StatCard label="Today" value={data?.stats.today ?? 0} />
            <StatCard label="This Week" value={data?.stats.week ?? 0} />
            <StatCard label="This Month" value={data?.stats.month ?? 0} />
          </div>

          <section className="apex-surface px-6 py-6">
            <p className="apex-eyebrow">Broadcast</p>
            <textarea
              value={message}
              onChange={event => setMessage(event.target.value)}
              rows={5}
              placeholder="Enter your message. HTML formatting is supported."
              className="apex-form-textarea mt-4"
            />

            {message.trim() ? (
              <div className="apex-stack-card mt-4">
                <p className="apex-admin-kpi-label">Preview</p>
                <div className="mt-3 whitespace-pre-wrap text-sm text-[var(--apex-text-secondary)]" dangerouslySetInnerHTML={{ __html: message }} />
              </div>
            ) : null}

            <div className="mt-5 flex flex-wrap items-center gap-3">
              <button onClick={broadcast} disabled={sending || !message.trim()} className="apex-button apex-button-amber disabled:opacity-40">
                {sending ? "Sending" : "Send To Channel"}
              </button>
              {sendResult ? (
                <span className={`text-sm ${sendResult.ok ? "text-[var(--apex-status-active-text)]" : "text-[var(--apex-status-blocked-text)]"}`}>
                  {sendResult.text}
                </span>
              ) : null}
            </div>
          </section>

          {(data?.recentAlerts.length ?? 0) > 0 ? (
            <section className="apex-table-shell px-6 py-5">
              <div className="mb-4">
                <p className="apex-eyebrow">Recent Alerts</p>
                <h3 className="mt-2 text-[18px] font-semibold tracking-[-0.03em] text-[var(--apex-text-primary)]">Latest outbound deliveries</h3>
              </div>
              <table className="apex-table">
                <thead>
                  <tr>
                    <th>Signal</th>
                    <th>Status</th>
                    <th>Sent</th>
                  </tr>
                </thead>
                <tbody>
                  {data!.recentAlerts.map(alert => (
                    <tr key={alert.id}>
                      <td>{alert.signal ? `${alert.signal.asset} ${alert.signal.direction} [${alert.signal.rank}]` : "—"}</td>
                      <td className={alert.status === "DELIVERED" || alert.status === "SENT" ? "text-[var(--apex-status-active-text)]" : alert.status === "FAILED" ? "text-[var(--apex-status-blocked-text)]" : "text-[var(--apex-text-secondary)]"}>
                        {alert.status}
                      </td>
                      <td>{new Date(alert.createdAt).toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          ) : null}
        </>
      ) : (
        <>
          {subsData ? (
            <div className="apex-admin-kpi-grid">
              <StatCard label="Total" value={subsData.total} />
              <StatCard label="Active" value={subsData.active} accent />
              <StatCard label="Inactive" value={subsData.total - subsData.active} muted />
            </div>
          ) : null}

          {dmTarget ? (
            <div className="apex-modal-backdrop fixed inset-0 z-50 flex items-center justify-center px-4">
              <div className="apex-modal-card w-full max-w-md space-y-4">
                <h3 className="font-[var(--apex-font-display)] text-[26px] font-semibold tracking-[-0.05em] text-[var(--apex-text-primary)]">
                  DM @{dmTarget.username ?? dmTarget.chatId}
                </h3>
                <textarea
                  value={dmText}
                  onChange={event => setDmText(event.target.value)}
                  rows={4}
                  placeholder="Message (HTML supported)"
                  className="apex-form-textarea"
                />
                <div className="flex gap-3">
                  <button onClick={sendDm} disabled={dmSending || !dmText.trim()} className="apex-button apex-button-amber flex-1 disabled:opacity-40">
                    {dmSending ? "Sending" : "Send"}
                  </button>
                  <button onClick={() => { setDmTarget(null); setDmText(""); }} className="apex-button apex-button-muted flex-1">
                    Cancel
                  </button>
                </div>
              </div>
            </div>
          ) : null}

          {!subsData ? (
            <div className="apex-empty-state">Loading subscribers…</div>
          ) : subsData.subscribers.length === 0 ? (
            <div className="apex-empty-state">No subscribers yet. Share your bot link to get started.</div>
          ) : (
            <div className="apex-table-shell overflow-hidden">
              <div className="overflow-x-auto px-6 py-5">
                <table className="apex-table min-w-[1120px]">
                  <thead>
                    <tr>
                      <th>User</th>
                      <th>Tier</th>
                      <th>Status</th>
                      <th>Alerts</th>
                      <th>Messages</th>
                      <th>Last Active</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {subsData.subscribers.map(subscriber => (
                      <tr key={subscriber.id}>
                        <td className="font-[var(--apex-font-body)] text-[var(--apex-text-primary)]">
                          <p>{subscriber.username ? `@${subscriber.username}` : `${subscriber.firstName ?? ""} ${subscriber.lastName ?? ""}`.trim() || subscriber.chatId}</p>
                          <p className="mt-1 text-[11px] text-[var(--apex-text-tertiary)]">{subscriber.chatId}</p>
                        </td>
                        <td>
                          <span className={`inline-flex rounded-full border px-2.5 py-1 text-[10px] font-medium uppercase tracking-[0.12em] ${subscriber.tier === "PRO" ? "border-[var(--apex-status-watchlist-border)] bg-[var(--apex-status-watchlist-bg)] text-[var(--apex-status-watchlist-text)]" : "border-[var(--apex-border-default)] bg-[rgba(255,255,255,0.03)] text-[var(--apex-text-secondary)]"}`}>
                            {subscriber.tier}
                          </span>
                        </td>
                        <td className={subscriber.status === "ACTIVE" ? "text-[var(--apex-status-active-text)]" : "text-[var(--apex-status-blocked-text)]"}>{subscriber.status}</td>
                        <td>{subscriber.alertsEnabled ? `${subscriber.alertRanks.join(",")} ${subscriber.alertAssets.length > 0 ? `· ${subscriber.alertAssets.join(",")}` : "· ALL"}` : "Off"}</td>
                        <td>{subscriber.messageCount}</td>
                        <td>{new Date(subscriber.lastActiveAt).toLocaleDateString()}</td>
                        <td className="pr-0 text-right">
                          <div className="flex justify-end gap-2">
                            <button onClick={() => setDmTarget(subscriber)} className="apex-link-button px-3 py-2 text-[10px]">
                              DM
                            </button>
                            <button
                              onClick={() => toggleSubscriber(subscriber)}
                              className={`inline-flex rounded-full border px-3 py-2 text-[10px] font-medium uppercase tracking-[0.12em] ${subscriber.status === "ACTIVE" ? "border-yellow-300/20 bg-yellow-300/10 text-yellow-300" : "border-[var(--apex-status-active-border)] bg-[var(--apex-status-active-bg)] text-[var(--apex-status-active-text)]"}`}
                            >
                              {subscriber.status === "ACTIVE" ? "Suspend" : "Activate"}
                            </button>
                            <button
                              onClick={() => deleteSubscriber(subscriber)}
                              className="inline-flex rounded-full border border-[var(--apex-status-blocked-border)] bg-[var(--apex-status-blocked-bg)] px-3 py-2 text-[10px] font-medium uppercase tracking-[0.12em] text-[var(--apex-status-blocked-text)]"
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
            </div>
          )}
        </>
      )}
    </div>
  );
}

function StatCard({
  label,
  value,
  accent = false,
  muted = false,
}: {
  label: string;
  value: number;
  accent?: boolean;
  muted?: boolean;
}) {
  return (
    <div className="apex-admin-kpi">
      <p className="apex-admin-kpi-label">{label}</p>
      <p className={`apex-admin-kpi-value ${accent ? "text-[var(--apex-status-active-text)]" : muted ? "text-[var(--apex-text-secondary)]" : ""}`}>{value}</p>
    </div>
  );
}
