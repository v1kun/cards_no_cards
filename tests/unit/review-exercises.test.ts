import { describe, expect, it } from "vitest";

import {
  buildPrompt,
  gradeObjective,
  normalizeAnswer,
  selectExerciseType,
  type ExerciseWord,
} from "@/domain/review/exercises";

const word: ExerciseWord = {
  id: "w1",
  lemma: "hablar",
  translation: "to speak",
  partOfSpeech: "verb",
  exampleSentence: "Quiero hablar español.",
  forms: ["hablo", "hablas"],
};

describe("selectExerciseType", () => {
  it("starts new words with multiple choice", () => {
    expect(selectExerciseType({ isNew: true, successfulRecalls: 0, lemma: word.lemma })).toBe(
      "multiple_choice",
    );
  });

  it("moves to reverse multiple choice after the first recall", () => {
    expect(selectExerciseType({ isNew: false, successfulRecalls: 1, lemma: word.lemma })).toBe(
      "multiple_choice_reverse",
    );
  });

  it("moves to typed recall after two recalls", () => {
    expect(selectExerciseType({ isNew: false, successfulRecalls: 2, lemma: word.lemma })).toBe(
      "recall",
    );
  });

  it("uses cloze when a bank cloze exists even without an example", () => {
    expect(
      selectExerciseType({
        isNew: false,
        successfulRecalls: 3,
        lemma: word.lemma,
        clozeAvailable: true,
      }),
    ).toBe("cloze");
  });

  it("uses cloze for well-known words with a usable example sentence", () => {
    expect(
      selectExerciseType({
        isNew: false,
        successfulRecalls: 3,
        lemma: word.lemma,
        exampleSentence: word.exampleSentence,
      }),
    ).toBe("cloze");
  });

  it("falls back to recall when there is no usable sentence", () => {
    expect(
      selectExerciseType({
        isNew: false,
        successfulRecalls: 5,
        lemma: word.lemma,
        exampleSentence: "No contiene la palabra.",
      }),
    ).toBe("recall");
  });
});

describe("buildPrompt", () => {
  it("shows the lemma and a sorted option list for multiple choice", () => {
    const prompt = buildPrompt(word, "multiple_choice", true, ["to eat", "red"]);
    expect(prompt.promptText).toBe("hablar");
    expect(prompt.options).toEqual(["red", "to eat", "to speak"]);
  });

  it("blanks the lemma in a cloze sentence without leaking the answer", () => {
    const prompt = buildPrompt(word, "cloze", false);
    expect(prompt.exerciseType).toBe("cloze");
    expect(prompt.promptText).toContain("_____");
    expect(prompt.promptText).not.toContain("hablar");
  });

  it("downgrades cloze to recall when no sentence is available", () => {
    const prompt = buildPrompt({ ...word, exampleSentence: null }, "cloze", false);
    expect(prompt.exerciseType).toBe("recall");
    expect(prompt.promptText).toBe("to speak");
  });
});

describe("gradeObjective", () => {
  it("accepts the translation for multiple choice", () => {
    expect(gradeObjective(word, "multiple_choice", "to speak")).toBe(true);
    expect(gradeObjective(word, "multiple_choice", "to eat")).toBe(false);
  });

  it("accepts the lemma or an inflected form for recall", () => {
    expect(gradeObjective(word, "recall", "hablar")).toBe(true);
    expect(gradeObjective(word, "recall", "hablo")).toBe(true);
    expect(gradeObjective(word, "recall", "comer")).toBe(false);
  });

  it("is lenient about accents, case, and surrounding punctuation", () => {
    const accion: ExerciseWord = {
      id: "w2",
      lemma: "acción",
      translation: "action",
      partOfSpeech: "noun",
    };
    expect(gradeObjective(accion, "recall", "Accion.")).toBe(true);
    expect(normalizeAnswer("  ¡Acción!  ")).toBe("accion");
  });

  it("rejects an empty answer", () => {
    expect(gradeObjective(word, "recall", "   ")).toBe(false);
  });
});
