import DailyRunsClient from "./DailyRunsClient";

export default function AdminDailyRunsPage() {
  return <DailyRunsClient canTrigger={process.env.APEX_SHOW_ADMIN_TRIGGER === "true"} />;
}
