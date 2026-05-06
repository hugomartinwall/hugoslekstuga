export default function Footer() {
  return (
    <footer className="mt-24 border-t-2 border-ink bg-cream-deep">
      <div className="mx-auto flex max-w-5xl flex-col items-start gap-3 px-5 py-8 text-sm text-ink-soft sm:flex-row sm:items-center sm:justify-between sm:px-8">
        <p>
          <span className="font-display font-bold text-ink">hugoslekstuga</span>
          {" — "}
          a small playhouse for tools.
        </p>
        <p className="text-ink-muted">
          Built with care, in the open.
        </p>
      </div>
    </footer>
  );
}
