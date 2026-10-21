import OpenAI from "openai";

import { AIProviderError, AIRateLimitError, AIResponseError } from "../errors";
import { RateLimiter, withRetry, withTimeout } from "../resilience";
import {
  answerEvaluationSchema,
  generatedExampleSchema,
  generatedExerciseSchema,
  parsedVocabularyProposalSchema,
  type AIProvider,
  type AnswerEvaluation,
  type ExerciseGenerationWord,
  type ExistingVocabularyCandidate,
  type GeneratedExample,
  type GeneratedExerciseSet,
  type ParsedVocabularyProposal,
} from "../types";

/**
 * OpenAI adapter for the {@link AIProvider} contract.
 *
 * Everything vendor-specific — the SDK import, prompt construction, and
 * JSON response handling — is confined to this file. The rest of the app
 * depends only on the provider-neutral interface and schemas, so adding or
 * swapping a provider never touches domain code.
 */

/**
 * Minimal chat seam the adapter depends on. The default implementation
 * wraps the OpenAI SDK; tests inject a fake to exercise prompt handling,
 * validation, and error paths without any network access.
 */
export interface ChatClient {
  /** Returns the raw assistant message content for a JSON-mode request. */
  complete(request: { system: string; user: string }): Promise<string>;
}

export type OpenAIProviderConfig = {
  apiKey: string;
  model: string;
  baseURL?: string;
  timeoutMs: number;
  maxRetries: number;
  /** Minimum spacing between requests, in milliseconds. */
  minIntervalMs: number;
  /** Overrides the default SDK-backed client; intended for tests. */
  client?: ChatClient;
};

type StatusCarrier = { status?: unknown; code?: unknown };

function isRetryable(error: unknown): boolean {
  // Malformed responses never become valid on retry.
  if (error instanceof AIResponseError) {
    return false;
  }
  if (error instanceof AIRateLimitError) {
    return true;
  }
  const status = (error as StatusCarrier | null)?.status;
  if (typeof status === "number") {
    return status === 429 || status >= 500;
  }
  // Network/timeout errors carry no HTTP status; retrying is reasonable.
  return true;
}

/** Wraps the OpenAI SDK, requesting strict JSON object responses. */
class SdkChatClient implements ChatClient {
  private readonly client: OpenAI;
  private readonly model: string;

  constructor(config: { apiKey: string; model: string; baseURL?: string }) {
    this.client = new OpenAI({ apiKey: config.apiKey, baseURL: config.baseURL });
    this.model = config.model;
  }

  async complete(request: { system: string; user: string }): Promise<string> {
    const completion = await this.client.chat.completions.create({
      model: this.model,
      temperature: 0.2,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: request.system },
        { role: "user", content: request.user },
      ],
    });
    return completion.choices[0]?.message?.content ?? "";
  }
}

export class OpenAIProvider implements AIProvider {
  readonly name = "openai";

  private readonly client: ChatClient;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;
  private readonly limiter: RateLimiter;

  constructor(config: OpenAIProviderConfig) {
    this.client =
      config.client ??
      new SdkChatClient({
        apiKey: config.apiKey,
        model: config.model,
        baseURL: config.baseURL,
      });
    this.timeoutMs = config.timeoutMs;
    this.maxRetries = config.maxRetries;
    this.limiter = new RateLimiter({ minIntervalMs: config.minIntervalMs });
  }

  async parseVocabulary(input: {
    text: string;
    existingVocabulary: ExistingVocabularyCandidate[];
  }): Promise<ParsedVocabularyProposal[]> {
    const existing = input.existingVocabulary
      .map(
        (candidate) =>
          `- ${candidate.lemma} (${candidate.partOfSpeech}) = ${candidate.translation}`,
      )
      .join("\n");

    const system = [
      "You extract Spanish vocabulary for a learner whose base language is English.",
      'Return a JSON object with a single key "items" whose value is an array.',
      "Each item must have: lemma (dictionary form), translation (English),",
      "partOfSpeech (one of noun, verb, adjective, adverb, preposition, pronoun,",
      "conjunction, expression, other), topics (array of short English labels),",
      "forms (array of { form, formType, grammarNote }), and needsReview (boolean).",
      "Optional fields: definition, gender (masculine, feminine, common, unknown),",
      "exampleSentence, exampleTranslation, confidence (0..1).",
      "Attach inflected forms to their lemma instead of creating duplicate items.",
      "Set needsReview=true when you are unsure. Never invent a translation you are",
      "not confident about; mark it for review instead.",
    ].join(" ");

    const user = [
      existing.length > 0
        ? `The learner already has these words; do not duplicate them:\n${existing}\n`
        : "",
      "Extract vocabulary from the following text:\n",
      input.text,
    ].join("");

    const raw = await this.call(system, user);
    const parsed = this.parseJson(raw);
    const items = Array.isArray((parsed as { items?: unknown }).items)
      ? (parsed as { items: unknown[] }).items
      : [];

    const proposals: ParsedVocabularyProposal[] = [];
    for (const candidate of items) {
      const result = parsedVocabularyProposalSchema.safeParse(candidate);
      if (result.success) {
        proposals.push(result.data);
        continue;
      }
      // Salvage partially-valid items so nothing is silently lost: keep the
      // entry but force it into the review queue.
      const salvaged = this.salvageProposal(candidate);
      if (salvaged) {
        proposals.push(salvaged);
      }
    }
    return proposals;
  }

  async generateExample(input: {
    lemma: string;
    translation: string;
    level?: string;
    topic?: string;
  }): Promise<GeneratedExample> {
    const system =
      "You write a single natural Spanish example sentence for a learner. " +
      'Return a JSON object: { "sentence": string, "translation": string }. ' +
      "The sentence is Spanish; the translation is English.";
    const user = [
      `Word: ${input.lemma} (${input.translation}).`,
      input.level ? `Learner level: ${input.level}.` : "",
      input.topic ? `Preferred topic: ${input.topic}.` : "",
    ]
      .filter(Boolean)
      .join(" ");

    const raw = await this.call(system, user);
    return this.validate(generatedExampleSchema, this.parseJson(raw), "generateExample");
  }

  async evaluateAnswer(input: {
    expectedMeaning: string;
    acceptedAnswers: string[];
    userAnswer: string;
    context?: string;
  }): Promise<AnswerEvaluation> {
    const system =
      "You grade a learner's answer leniently but honestly. " +
      'Return a JSON object: { "result": one of "correct" | "partially_correct" | ' +
      '"incorrect" | "uncertain", "feedback": string }. ' +
      "Accept synonyms and minor typos as correct.";
    const user = [
      `Expected meaning: ${input.expectedMeaning}.`,
      `Accepted answers: ${input.acceptedAnswers.join(", ") || "(none)"}.`,
      input.context ? `Context: ${input.context}.` : "",
      `Learner answer: ${input.userAnswer}.`,
    ]
      .filter(Boolean)
      .join(" ");

    const raw = await this.call(system, user);
    return this.validate(answerEvaluationSchema, this.parseJson(raw), "evaluateAnswer");
  }

  async generateExercises(input: {
    words: ExerciseGenerationWord[];
    translationLanguage: string;
  }): Promise<GeneratedExerciseSet[]> {
    if (input.words.length === 0) return [];
    const language = input.translationLanguage === "ru" ? "Russian" : "English";
    const system = [
      "You write Spanish vocabulary practice questions for an A1–A2 learner.",
      `The learner's language is ${language}: translations and instructions are in ${language}.`,
      'Return a JSON object: { "words": [ { "key": string, "exercises": [ ... ] } ] },',
      "with one entry per input word, echoing its key.",
      "Each exercise is { exerciseType, instruction, promptText, options?, correctAnswer,",
      "acceptedAnswers }. For each word write exactly:",
      `- 2 "multiple_choice": promptText is the Spanish word (or a short Spanish phrase using it),`,
      `  options are 4 ${language} meanings (one correct, three plausible but clearly wrong).`,
      `- 2 "multiple_choice_reverse": promptText is the ${language} meaning, options are 4`,
      "  Spanish words of the same part of speech (one correct).",
      "Wrong options must come from the same topic as the word (e.g. other animals for an",
      "animal): take them from the word's topicWords when given (their translation or lemma),",
      "otherwise invent words of that topic. Never use a synonym of the correct answer.",
      `- 1 "recall": promptText is the ${language} meaning; the learner types the Spanish word.`,
      `- 2 "cloze": promptText is a NEW short natural Spanish sentence with the word replaced`,
      `  by "_____" followed by the ${language} hint in parentheses; the answer is the exact`,
      "  form that fits (it may be an inflected form).",
      "correctAnswer must appear verbatim among options for multiple choice.",
      "acceptedAnswers lists every answer that must be graded correct (include the",
      "correct answer; for recall add accepted variants such as articles or inflections).",
      "Never include the answer in promptText except the Spanish word in multiple_choice.",
    ].join(" ");
    const user = JSON.stringify({
      words: input.words.map((word) => ({
        key: word.key,
        lemma: word.lemma,
        translation: word.translation,
        partOfSpeech: word.partOfSpeech,
        forms: word.forms,
        example: word.exampleSentence ?? undefined,
        topics: word.topics?.length ? word.topics : undefined,
        topicWords: word.topicWords?.length ? word.topicWords : undefined,
      })),
    });

    const raw = await this.call(system, user);
    const parsed = this.parseJson(raw) as { words?: unknown };
    const entries = Array.isArray(parsed.words) ? parsed.words : [];
    const sets: GeneratedExerciseSet[] = [];
    for (const entry of entries) {
      if (typeof entry !== "object" || entry === null) continue;
      const record = entry as { key?: unknown; exercises?: unknown };
      if (typeof record.key !== "string" || !Array.isArray(record.exercises)) continue;
      const exercises = record.exercises.flatMap((candidate) => {
        const result = generatedExerciseSchema.safeParse(candidate);
        return result.success ? [result.data] : [];
      });
      sets.push({ key: record.key, exercises });
    }
    return sets;
  }

  /** Runs one request through the rate limiter, retry, and timeout stack. */
  private call(system: string, user: string): Promise<string> {
    return this.limiter.schedule(() =>
      withRetry(
        () =>
          withTimeout(this.client.complete({ system, user }), {
            timeoutMs: this.timeoutMs,
            provider: this.name,
          }).catch((error) => {
            throw this.normalize(error);
          }),
        { maxRetries: this.maxRetries, shouldRetry: isRetryable },
      ),
    );
  }

  private normalize(error: unknown): unknown {
    if (error instanceof AIProviderError) {
      return error;
    }
    const status = (error as StatusCarrier | null)?.status;
    if (status === 429) {
      return new AIRateLimitError({ provider: this.name, cause: error });
    }
    return new AIProviderError("AI request failed", { provider: this.name, cause: error });
  }

  private parseJson(raw: string): unknown {
    try {
      return JSON.parse(raw);
    } catch (error) {
      throw new AIResponseError("AI returned non-JSON output", {
        provider: this.name,
        cause: error,
      });
    }
  }

  private validate<T>(
    schema: { safeParse: (value: unknown) => { success: true; data: T } | { success: false } },
    value: unknown,
    operation: string,
  ): T {
    const result = schema.safeParse(value);
    if (!result.success) {
      throw new AIResponseError(`AI returned invalid output for ${operation}`, {
        provider: this.name,
      });
    }
    return result.data;
  }

  private salvageProposal(candidate: unknown): ParsedVocabularyProposal | null {
    if (typeof candidate !== "object" || candidate === null) {
      return null;
    }
    const record = candidate as Record<string, unknown>;
    const lemma = typeof record.lemma === "string" ? record.lemma.trim() : "";
    if (lemma.length === 0) {
      return null;
    }
    const translation =
      typeof record.translation === "string" && record.translation.trim().length > 0
        ? record.translation.trim()
        : lemma;
    return {
      lemma,
      translation,
      partOfSpeech: "other",
      topics: [],
      forms: [],
      needsReview: true,
    } satisfies ParsedVocabularyProposal;
  }
}
