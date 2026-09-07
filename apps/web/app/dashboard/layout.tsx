import Link from "next/link";

export default function DashboardLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <>
      <div className="container" style={{ paddingTop: 18 }}>
        <nav className="actions" aria-label="Workspace navigation" style={{ marginTop: 0 }}>
          <Link className="button" href="/dashboard">Research dashboard</Link>
          <Link className="button" href="/dashboard/ai">Genithm AI</Link>
        </nav>
      </div>
      {children}
    </>
  );
}
