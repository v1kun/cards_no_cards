import Link from "next/link";
import type { CSSProperties } from "react";

const placeholderStyle: CSSProperties = {
  border: "1px dashed #3a3a46",
  borderRadius: "8px",
  background: "#101017",
  color: "#6f6f80",
  padding: "1.1rem 1rem",
  textAlign: "center",
  fontSize: "0.82rem",
  lineHeight: 1.4,
};

/** A labelled placeholder standing in for a real screenshot. */
function Shot({ label }: { label: string }) {
  return (
    <div style={placeholderStyle} role="img" aria-label={`Screenshot placeholder: ${label}`}>
      🖼️ <strong>Screenshot</strong>
      <br />
      {label}
    </div>
  );
}

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
        <h2>Before you begin</h2>
        <ol className="stack" style={{ paddingLeft: "1.1rem" }}>
          <li>
            <strong>Start the server on the network.</strong> In local development run{" "}
            <code>npm run dev:lan</code> so the app is reachable from your phone, not just{" "}
            <code>localhost</code>.
          </li>
          <li>
            <strong>Find the server address.</strong> On the Mac, run{" "}
            <code>ipconfig getifaddr en0</code> to get the LAN IP (for example{" "}
            <code>192.168.68.50</code>). Your base URL is then{" "}
            <code>http://192.168.68.50:3000</code>.
          </li>
          <li>
            <strong>Put both devices on the same Wi-Fi.</strong> The iPhone and the Mac must share
            the network. Confirm it works by opening the base URL in Safari on the phone first.
          </li>
          <li>
            <strong>
              Keep the <code>Shortcuts</code> app handy.
            </strong>{" "}
            It is preinstalled on iOS; search for &ldquo;Shortcuts&rdquo; in Spotlight if you
            don&apos;t see it.
          </li>
        </ol>
        <p className="muted">
          Everywhere below, replace <code>YOUR-SERVER:3000</code> with the base URL you found in
          step&nbsp;2.
        </p>
      </section>

      <section className="card stack">
        <h2>Shortcut: &ldquo;Add a Spanish word&rdquo;</h2>
        <p className="muted">
          Dictate a word (or a short &ldquo;word — translation&rdquo; line), send it to the app, and
          have Siri read back the confirmation.
        </p>
        <ol className="stack" style={{ paddingLeft: "1.1rem" }}>
          <li>
            Open the <strong>Shortcuts</strong> app and tap <strong>+</strong> to create a new
            shortcut.
            <Shot label="Shortcuts app — the + button in the top-right to add a new shortcut" />
          </li>
          <li>
            Tap <strong>Add Action</strong>, search for <strong>Dictate Text</strong>, and add it.
            Tap <em>Language</em> on the action and choose <strong>Spanish</strong>.
            <Shot label="Dictate Text action with Language set to Spanish" />
          </li>
          <li>
            Add <strong>Get Contents of URL</strong> and configure it:
            <ul className="stack" style={{ paddingLeft: "1.1rem" }}>
              <li>
                URL: <code>http://YOUR-SERVER:3000/api/v1/capture</code>
              </li>
              <li>
                Expand <strong>Show More</strong> → Method: <code>POST</code>
              </li>
              <li>
                Headers: add <code>Content-Type</code> = <code>application/json</code>
              </li>
              <li>
                Request Body: <strong>JSON</strong>, add a field named <code>text</code> whose value
                is the <em>Dictated Text</em> variable.
              </li>
            </ul>
            <Shot label="Get Contents of URL — POST, JSON body with a text field set to Dictated Text" />
          </li>
          <li>
            Add <strong>Get Dictionary Value</strong> and set the key to <code>data.message</code>.
            (The API wraps responses in a <code>data</code> object.)
          </li>
          <li>
            Add <strong>Speak Text</strong> and pass the value from the previous step so Siri reads
            the confirmation aloud.
            <Shot label="Get Dictionary Value (data.message) followed by Speak Text" />
          </li>
          <li>
            Rename the shortcut to something Siri hears clearly, e.g. &ldquo;Add Spanish
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
            <Shot label="GET request, then Get Dictionary Value (data.message) and Speak Text" />
          </li>
        </ol>
        <p className="muted">
          To jump straight into a session, a one-step shortcut can simply <strong>Open URL</strong>{" "}
          <code>http://YOUR-SERVER:3000/practice</code>.
        </p>
      </section>

      <section className="card stack">
        <h2>Troubleshooting</h2>
        <ul className="stack" style={{ paddingLeft: "1.1rem" }}>
          <li>
            <strong>&ldquo;Could not connect to the server.&rdquo;</strong> The phone can&apos;t
            reach the Mac. Check both are on the same Wi-Fi, that you ran{" "}
            <code>npm run dev:lan</code> (plain <code>npm run dev</code> only binds{" "}
            <code>localhost</code>), and that the IP in the URL is current — it can change when the
            Mac reconnects to Wi-Fi.
          </li>
          <li>
            <strong>Siri speaks nothing / &ldquo;no value&rdquo;.</strong> The{" "}
            <strong>Get Dictionary Value</strong> key must be exactly <code>data.message</code>, not{" "}
            <code>message</code> — responses are wrapped in <code>data</code>.
          </li>
          <li>
            <strong>Says &ldquo;I couldn&apos;t capture any words.&rdquo;</strong> The dictation was
            empty or unparseable. Try again, or dictate as <code>word - translation</code> (e.g.
            &ldquo;despedirse dash to say goodbye&rdquo;).
          </li>
          <li>
            <strong>HTTP 400 / validation error.</strong> The body must be JSON with a{" "}
            <code>text</code> field. Double-check the request body type is <strong>JSON</strong> and
            the field name is lowercase <code>text</code>.
          </li>
          <li>
            <strong>Word never shows up in vocabulary.</strong> That&apos;s expected — captured
            words wait in <Link href="/import">Import</Link> as <em>needs review</em> until you
            confirm them.
          </li>
          <li>
            <strong>Works at home but not elsewhere.</strong> A local LAN IP only works on that
            network. Away from home you need the app deployed with the (deferred) cloud auth, which
            Shortcuts can&apos;t easily complete.
          </li>
        </ul>
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
