export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="grid min-h-dvh place-items-center bg-fill px-4">
      <div className="w-full max-w-sm rounded-lg border border-line-soft bg-paper p-6 shadow-sm">
        {children}
      </div>
    </main>
  );
}
