import { genders, partsOfSpeech } from "@/server/db/schema";

type PartOfSpeech = (typeof partsOfSpeech)[number];
type Gender = (typeof genders)[number];

export type StarterDeckEntry = {
  lemma: string;
  partOfSpeech: PartOfSpeech;
  gender?: Gender;
  translation: string;
  exampleSentence: string;
  exampleTranslation: string;
  topic: string;
};

export type StarterDeckIssue = { file: string; line: number; message: string };

/**
 * Parses one starter-deck TSV file. A `# topic: <name>` comment sets the topic
 * for the rows that follow; each row has six tab-separated columns: lemma,
 * part of speech, gender (`-` when not applicable), translation, example
 * sentence, and example translation.
 */
export function parseStarterDeckFile(
  file: string,
  content: string,
): { entries: StarterDeckEntry[]; issues: StarterDeckIssue[] } {
  const entries: StarterDeckEntry[] = [];
  const issues: StarterDeckIssue[] = [];
  let topic: string | undefined;

  content.split(/\r?\n/).forEach((raw, index) => {
    const line = index + 1;
    if (raw.trim().length === 0) return;
    if (raw.startsWith("#")) {
      const match = /^#\s*topic:\s*(.+)$/i.exec(raw.trim());
      if (match?.[1]) topic = match[1].trim();
      return;
    }

    const columns = raw.split("\t").map((column) => column.trim());
    const [lemma, pos, gender, translation, exampleSentence, exampleTranslation] = columns;
    if (
      columns.length !== 6 ||
      !lemma ||
      !pos ||
      !gender ||
      !translation ||
      !exampleSentence ||
      !exampleTranslation
    ) {
      issues.push({ file, line, message: "expected 6 non-empty tab-separated columns" });
      return;
    }
    if (!topic) {
      issues.push({ file, line, message: "row appears before a '# topic:' header" });
      return;
    }
    if (!isPartOfSpeech(pos)) {
      issues.push({ file, line, message: `unknown part of speech "${pos}"` });
      return;
    }
    if (gender !== "-" && !isGender(gender)) {
      issues.push({ file, line, message: `unknown gender "${gender}"` });
      return;
    }

    entries.push({
      lemma,
      partOfSpeech: pos,
      gender: isGender(gender) ? gender : undefined,
      translation,
      exampleSentence,
      exampleTranslation,
      topic,
    });
  });

  return { entries, issues };
}

/** True when the example contains the lemma as a whole word (case-insensitive). */
export function exampleContainsLemma(
  entry: Pick<StarterDeckEntry, "lemma" | "exampleSentence">,
): boolean {
  const escaped = entry.lemma.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^\\p{L}])${escaped}([^\\p{L}]|$)`, "iu").test(entry.exampleSentence);
}

function isPartOfSpeech(value: string): value is PartOfSpeech {
  return (partsOfSpeech as readonly string[]).includes(value);
}

function isGender(value: string): value is Gender {
  return (genders as readonly string[]).includes(value);
}
