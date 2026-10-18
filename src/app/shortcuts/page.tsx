import Link from "next/link";

export default function ShortcutsPage() {
  return (
    <main>
      <div className="row">
        <h1>Voice capture with Siri Shortcuts</h1>
        <Link href="/">Home</Link>
      </div>

      <section className="card stack">
        <p>
          Cards No Cards is a web app, so there is no deep native Siri integration. You can still
          add words and check your queue by voice using Apple&nbsp;Shortcuts, which can dictate text
          and call the app&apos;s API over the network.
        </p>
        <p className="muted">
          This works while your iPhone can reach the server (same Wi-Fi in local development, or the
          deployed URL later). The Shortcut talks to the same authenticated session as the browser.
        </p>
      </section>

      <section className="card stack">
        <h2>Shortcut: &ldquo;Add a Spanish word&rdquo;</h2>
        <ol className="stack" style={{ paddingLeft: "1.1rem" }}>
          <li>
            Open the <strong>Shortcuts</strong> app and create a new shortcut.
          </li>
          <li>
            Add <strong>Dictate Text</strong> (language: Spanish).
          </li>
          <li>
            Add <strong>Get Contents of URL</strong> and set:
            <ul className="stack" style={{ paddingLeft: "1.1rem" }}>
              <li>
                URL: <code>http://YOUR-SERVER:3000/api/v1/capture</code>
              </li>
              <li>
                Method: <code>POST</code>
              </li>
              <li>
                Headers: <code>Content-Type: application/json</code>
              </li>
              <li>
                Request Body: <strong>JSON</strong> with a <code>text</code> field set to the{" "}
                <em>Dictated Text</em> variable.
              </li>
            </ul>
          </li>
          <li>
            Add <strong>Get Dictionary Value</strong> for key <code>data.message</code>, then{" "}
            <strong>Speak Text</strong> with that value.
          </li>
          <li>
            Rename the shortcut to something Siri can hear clearly, e.g. &ldquo;Add Spanish
            word&rdquo;. Say &ldquo;Hey Siri, Add Spanish word&rdquo; to run it.
          </li>
        </ol>
      </section>

      <section className="card stack">
        <h2>Shortcut: &ldquo;What should I practice?&rdquo;</h2>
        <ol className="stack" style={{ paddingLeft: "1.1rem" }}>
          <li>
            Add <strong>Get Contents of URL</strong> with method <code>GET</code> to{" "}
            <code>http://YOUR-SERVER:3000/api/v1/capture</code>.
          </li>
          <li>
            Add <strong>Get Dictionary Value</strong> for <code>data.message</code> and{" "}
            <strong>Speak Text</strong> with it.
          </li>
        </ol>
        <p className="muted">
          To jump straight into a session, a one-step shortcut can simply <strong>Open URL</strong>{" "}
          <code>http://YOUR-SERVER:3000/practice</code>.
        </p>
      </section>

      <section className="card stack">
        <h2>API reference</h2>
        <ul className="stack" style={{ paddingLeft: "1.1rem" }}>
          <li>
            <code>POST /api/v1/capture</code> — body <code>{`{ "text": "despedirse" }`}</code>.
            Routes the text through the import pipeline as a <code>voice</code> source and returns a
            spoken <code>message</code>.
          </li>
          <li>
            <code>GET /api/v1/capture</code> — returns <code>{`{ due, new, message }`}</code>{" "}
            summarizing what is waiting to be practiced.
          </li>
        </ul>
        <p className="muted">
          Captured words land in <Link href="/import">Import</Link> as <em>needs review</em>, so you
          confirm them before they enter your vocabulary — voice never writes unreviewed data
          directly.
        </p>
      </section>
    </main>
  );
}
