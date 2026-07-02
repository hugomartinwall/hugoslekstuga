export default function Footer() {
  const year = new Date().getFullYear();
  return (
    <footer className="mt-24 border-t border-line bg-cream-deep">
      <div className="mx-auto flex max-w-5xl flex-col-reverse items-start justify-between gap-3 px-5 py-6 text-xs text-ink-muted sm:flex-row sm:items-center sm:px-8">
        <p>© {year}</p>
        <p>potentially useful</p>
      </div>
    </footer>
  );
}
