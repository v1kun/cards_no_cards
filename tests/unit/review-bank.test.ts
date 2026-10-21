import { describe, expect, it } from "vitest";

import { bankItemToExercise, validateBankPayload, wordSourceHash } from "@/domain/review/bank";
import { gradeAnswer } from "@/domain/review/exercises";

const word = {
  lemma: "hablar",
  translation: "to speak",
  partOfSpeech: "verb",
  exampleSentence: "Quiero hablar.",
  forms: ["hablo", "hablas"],
};

describe("wordSourceHash", () => {
  it("is stable regardless of form order", () => {
    expect(wordSourceHash(word, "en")).toBe(
      wordSourceHash({ ...word, forms: ["hablas", "hablo"] }, "en"),
    );
  });

  it("changes when a relevant field or the language changes", () => {
    const base = wordSourceHash(word, "en");
    expect(wordSourceHash({ ...word, translation: "to talk" }, "en")).not.toBe(base);
    expect(wordSourceHash({ ...word, exampleSentence: "Otra." }, "en")).not.toBe(base);
    expect(wordSourceHash(word, "ru")).not.toBe(base);
  });
});

describe("validateBankPayload", () => {
  const mc = {
    instruction: "Choose the translation.",
    promptText: "hablar",
    options: ["to speak", "to eat", "to run", "red"],
    correctAnswer: "to speak",
    acceptedAnswers: ["to speak"],
  };

  it("accepts a well-formed multiple choice question", () => {
    expect(validateBankPayload("multiple_choice", mc)).not.toBeNull();
  });

  it("rejects multiple choice without the answer among options", () => {
    expect(validateBankPayload("multiple_choice", { ...mc, options: ["a", "b", "c"] })).toBeNull();
  });

  it("rejects ambiguous options that are also accepted", () => {
    expect(
      validateBankPayload("multiple_choice", {
        ...mc,
        acceptedAnswers: ["to speak", "to eat"],
      }),
    ).toBeNull();
  });

  it("rejects a cloze without a blank or one that leaks the answer", () => {
    const cloze = {
      instruction: "Fill in the blank.",
      promptText: "Quiero _____ contigo.",
      correctAnswer: "hablar",
      acceptedAnswers: ["hablar"],
    };
    expect(validateBankPayload("cloze", cloze)).not.toBeNull();
    expect(validateBankPayload("cloze", { ...cloze, promptText: "Quiero contigo." })).toBeNull();
    expect(
      validateBankPayload("cloze", { ...cloze, promptText: "Hablar: quiero _____ contigo." }),
    ).toBeNull();
  });

  it("always includes the correct answer among accepted answers", () => {
    const payload = validateBankPayload("recall", {
      instruction: "Type the Spanish word.",
      promptText: "to speak",
      correctAnswer: "hablar",
      acceptedAnswers: ["conversar"],
    });
    expect(payload?.acceptedAnswers).toEqual(["hablar", "conversar"]);
  });
});

describe("bankItemToExercise + gradeAnswer", () => {
  it("produces a gradable exercise with sorted options", () => {
    const exercise = bankItemToExercise(
      {
        id: "b1",
        vocabularyItemId: "w1",
        exerciseType: "multiple_choice",
        sourceHash: "x",
        payload: {
          instruction: "Choose.",
          promptText: "hablar",
          options: ["to speak", "red", "to eat"],
          correctAnswer: "to speak",
          acceptedAnswers: ["to speak"],
        },
      },
      true,
    );
    expect(exercise.options).toEqual(["red", "to eat", "to speak"]);
    expect(exercise.bankItemId).toBe("b1");
    expect(gradeAnswer(exercise.acceptedAnswers, "To speak.")).toBe("recalled");
    expect(gradeAnswer(exercise.acceptedAnswers, "to eat")).toBe("wrong");
    expect(gradeAnswer(exercise.acceptedAnswers, "to speak", { usedHint: true })).toBe(
      "recalled_with_hint",
    );
    expect(gradeAnswer(exercise.acceptedAnswers, "", { skipped: true })).toBe("skipped");
    expect(gradeAnswer(exercise.acceptedAnswers, "  ")).toBe("wrong");
  });
});
