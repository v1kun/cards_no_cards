import Link from "next/link";

export default function InstallPage() {
  return (
    <main>
      <div className="row">
        <h1>Install on your iPhone</h1>
        <Link href="/">Home</Link>
      </div>

      <section className="card stack">
        <p>
          Cards No Cards is a Progressive Web App. On iPhone it installs to your home screen from
          Safari and opens full-screen, like a native app.
        </p>
        <ol className="stack" style={{ paddingLeft: "1.1rem" }}>
          <li>Open this site in Safari (installation is not available from other iOS browsers).</li>
          <li>
            Tap the <strong>Share</strong> button (the square with an upward arrow) in the toolbar.
          </li>
          <li>
            Scroll down and tap <strong>Add to Home Screen</strong>.
          </li>
          <li>
            Confirm the name and tap <strong>Add</strong>. The app icon appears on your home screen.
          </li>
          <li>Launch it from the home screen and sign in as usual.</li>
        </ol>
        <p className="muted">
          Installing adds an icon and full-screen launch. Your vocabulary and review history live on
          the server and sync when you are online; nothing private is stored offline by default.
        </p>
      </section>
    </main>
  );
}
