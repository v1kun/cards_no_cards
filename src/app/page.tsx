import Link from "next/link";

export default function HomePage() {
  return (
    <main>
      <h1>Cards No Cards</h1>
      <p>Personal Spanish vocabulary-retention app. Development skeleton.</p>
      <p>
        <Link href="/vocabulary">Manage vocabulary →</Link>
      </p>
      <p>
        <Link href="/import">Import from lesson notes →</Link>
      </p>
      <p>
        <Link href="/practice">Start a practice session →</Link>
      </p>
      <p>
        <Link href="/install">Install on your iPhone →</Link>
      </p>
    </main>
  );
}
