import { PageHeader } from "@/components/ui";

export default function InstallPage() {
  return (
    <main>
      <PageHeader title="Install on your iPhone" back={{ href: "/", label: "Home" }} />

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
          the server. Practice also works offline: open Practice once while online and the app keeps
          a copy of your words and prepared questions on this device. Answers given offline are
          saved locally and sync automatically when you are back online.
        </p>
      </section>
    </main>
  );
}
