import { describe, expect, it } from "vitest";

import { topicEmoji } from "@/lib/client/labels";

describe("topicEmoji", () => {
  it.each([
    ["Транспорт и путешествия", "🚌"],
    ["Покупки и деньги", "🛍️"],
    ["Хобби и свободное время", "⚽"],
    ["Время и календарь", "🕒"],
    ["Повседневные действия", "🏃"],
    ["Служебные слова", "🧩"],
    ["Something else", "🏷️"],
  ])("%s → %s", (name, emoji) => {
    expect(topicEmoji(name)).toBe(emoji);
  });
});
