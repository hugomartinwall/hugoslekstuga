/**
 * Curated advice list. Each line should make a thoughtful person stop
 * for half a second — "ahh, true" or a sharp "huh," not a nod, not a
 * productivity tip, not a wellness affirmation.
 *
 * REJECT:
 *   - Life hacks, productivity clichés, pat platitudes
 *   - Anything that could appear on a laminated office poster
 *   - Two-sentence constructions where the second sentence is flourish
 *     rather than a turn — cut the second if it doesn't reverse,
 *     sharpen, or compress the first
 *   - Anything that could be 30% shorter without losing the insight
 *   - Anything that needs more than half a second to parse
 *
 * KEEP:
 *   - Compressed truths with a clean turn or reversal
 *   - Lines you'd screenshot for a friend
 *   - Honest observations most people pretend not to see
 *
 * Entries are structured now that Hugo delivers them himself:
 *   - `tone` lets his mood bias the draw (grumpy Hugo leans blunt)
 *   - `id` is a content hash. Editing a line resets that line's
 *     told-you-this memory — acceptable; edits are rare and the cost
 *     is one repeat.
 */

export type AdviceTone = "warm" | "blunt" | "wry";

export type AdviceEntry = {
  id: string;
  text: string;
  tone: AdviceTone;
};

/** djb2, base36, 6 chars — stable across sessions, unique enough for ~100 lines. */
function adviceId(text: string): string {
  let h = 5381;
  for (let i = 0; i < text.length; i++) {
    h = ((h << 5) + h + text.charCodeAt(i)) | 0;
  }
  return Math.abs(h).toString(36).slice(0, 6);
}

const COMMON: [AdviceTone, string][] = [
  ["blunt", "Most regrets are about not doing."],
  ["warm", "Good days don't announce themselves."],
  ["wry", "Most adults are children with credit cards."],
  ["wry", "The opposite of love isn't hate. It's logistics."],
  ["blunt", "Worrying means you suffer twice."],
  ["warm", "Visit your grandparents while you can still get a straight answer."],
  ["warm", "The argument is rarely about the argument."],
  ["blunt", "If you're rehearsing the conversation, have it."],
  ["blunt", "Most lies are told to ourselves first."],
  ["blunt", 'Apologize without "but."'],
  ["blunt", "Send the message you're avoiding."],
  ["warm", "How you spend your days is how you spend your life."],
  ["blunt", "You can't think your way out of what you've been doing for years."],
  ["warm", "What looks like laziness is usually fear."],
  ["blunt", "You become what you keep almost-doing."],
  ["blunt", "You can't edit what doesn't exist."],
  ["wry", "Copy what you love. Originality is what's left over."],
  ["warm", "Talent is just consistency you can't see."],
  ["warm", "Trust people whose stories include their own mistakes."],
  ["wry", "Watch how people treat the waiter."],
  ["blunt", "If you can't say it in one sentence, you don't know what you mean yet."],
  ["blunt", "A quick no is kinder than a slow yes."],
  ["blunt", "Environment beats willpower."],
  ["wry", "Don't lend money to friends you can't afford to lose."],
  ["blunt", "What you tolerate, you teach."],
  ["warm", "Curiosity ages better than ambition."],
  ["warm", "The smartest people change their mind in public."],
  ["wry", "Most good work is bad work, edited."],
  ["blunt", "If you wait until you're ready, you'll wait forever."],
  ["blunt", "If everyone agrees with you, you're not saying anything."],
  ["wry", "You won't remember the night you went to bed early."],
  ["warm", "Most things you're worried about will not happen."],
  ["blunt", "Every yes is a no to something else."],
  ["warm", "Stop blaming who you were for not being who you are."],
  ["warm", "Resentment is a tax on a debt that isn't yours."],
  ["blunt", "If a friend keeps making you feel small, see them less."],
  ["warm", "Praise people behind their backs."],
  ["wry", "Most arguments are people meaning different things by the same word."],
  ["blunt", "Don't get even. Get good."],
  ["warm", "Wanting pulls you off the path you came to walk."],
  ["warm", "Carry a grudge far enough and it becomes the room you live in."],
  ["warm", "A mind on every branch is at home on none."],
  ["blunt", "Doubt isn't thinking. It's thinking refusing to end."],
  ["warm", "You can't outrun a feeling you haven't named."],
  ["warm", "What you refuse to feel runs your day from underneath."],
  ["warm", "Look at anger long enough and it admits it was fear."],
  ["warm", "You are not your thoughts. You are who notices them."],
  ["blunt", "Two ways to fail a path: not stepping on it, and stepping off."],
  ["warm", "Outside answers don't reach inside questions."],
  ["wry", "Other people's paths look easier because you can't feel their gravel."],
  ["warm", "Clarity isn't seeing more. It's seeing what's connected."],
  ["wry", "The body keeps receipts the mind threw away."],
  ["blunt", "Most of what you call confusion is noise you haven't muted."],
  ["warm", "Sit still long enough and you'll notice you've been chasing nothing."],
  ["blunt", "Perfection isn't a thing. Repetition is the thing."],
  ["blunt", "If a practice isn't worth doing daily, it isn't worth doing."],
  ["blunt", "Restrictions make room. Choice makes noise."],
  ["warm", "Freedom is what's left after you've said no to enough."],
  ["warm", "When you eat, eat. When you walk, walk."],
  ["blunt", "Don't announce the change. Change."],
  ["warm", "Attention is the only thing you actually own."],
  ["warm", "Where your energy lands is what you're growing."],
  ["blunt", "Most of what you call thinking is reaction in disguise."],
  ["warm", "Suffering is the gap between what is and what you wanted."],
];

export const adviceEntries: AdviceEntry[] = COMMON.map(
  ([tone, text]): AdviceEntry => ({
    id: adviceId(text),
    text,
    tone,
  }),
);
