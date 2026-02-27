export function ProjectLogsTab() {
  return (
    <div className="empty-state" style={{ padding: 40 }}>
      <h3>Request Logs</h3>
      <p style={{ color: 'var(--text-secondary)', marginTop: 8 }}>
        Recent API requests routed by this project will appear here.
      </p>
    </div>
  );
}
