import type { ToolColor } from "./tools";

export type Tip = {
  title: string;
  body: string;
  source?: string;
};

export type Feeling = {
  slug: string;
  label: string;
  emoji: string;
  blurb: string;
  color: ToolColor;
  tips: Tip[];
};

/**
 * Tips draw on CBT, ACT, behavioral activation, self-compassion, sleep
 * and exercise research, and a bit of folk wisdom that's earned its place.
 *
 * Voice rules (same as `advice` — break them, lose them):
 *   - Title is a concrete command or a memorable image. Not a question.
 *   - Body is 1–3 sentences. Every sentence has to do work; if the
 *     second one doesn't reverse, sharpen, or compress the first, cut it.
 *   - No "you should consider…" / "have you tried…" / hedge words.
 *   - Source label is a short lineage tag, not a citation. Skip it if the
 *     tip is just plain sense.
 *   - Order tips body-first → cognitive → social/long-term, so the first
 *     ones land in the next 5 minutes and the last ones land over weeks.
 */
export const feelings: Feeling[] = [
  {
    slug: "anxious",
    label: "Anxious",
    emoji: "🌀",
    color: "blue",
    blurb:
      "Your nervous system is bracing for a threat that may or may not be real.",
    tips: [
      {
        title: "Slow the exhale, not the inhale",
        body: "Breathe in for 4, out for 6 to 8. The long out-breath turns on the parasympathetic nervous system. Ninety seconds is usually enough to feel the shift.",
        source: "Vagal-tone research",
      },
      {
        title: "5-4-3-2-1 the room",
        body: "Five things you see, four you hear, three you can touch, two you smell, one you taste. Drags the brain out of the catastrophic future and back into the actual room.",
        source: "Trauma-informed CBT",
      },
      {
        title: "Eat or drink something",
        body: "Low blood sugar and mild dehydration both look exactly like anxiety. A glass of water and something with protein in the next ten minutes. Judge afterwards.",
      },
      {
        title: "Find the action under the thought",
        body: "A lot of anxiety is an undone task wearing a costume. Ask: is there one concrete thing I could do in 15 minutes that would actually lower this? If yes, do it. If no, the worry is information, not instruction.",
        source: "CBT",
      },
      {
        title: "Write the worry, then schedule it",
        body: "On paper, in one sentence: what specifically am I afraid of? Pick a 15-minute slot tomorrow to think about it. Until then, the brain has permission to set it down.",
        source: "Worry postponement, CBT",
      },
      {
        title: "Move for ten minutes",
        body: "Brisk walk, stairs, anything that lifts your heart rate. Anxiety is partly stuck physical energy. You can't think your way out of it as fast as you can walk out of it.",
        source: "Behavioral activation",
      },
    ],
  },
  {
    slug: "sad",
    label: "Sad",
    emoji: "🌧",
    color: "purple",
    blurb:
      "Sadness slows you down so you can metabolise loss. It usually wants company more than fixing.",
    tips: [
      {
        title: "Cry if you need to",
        body: "Tears actually do something — they release stress hormones and signal to others that you need care. Suppressing the cry doesn't dispose of the sadness; it just stores it.",
      },
      {
        title: "Reach out to one person",
        body: "A 30-second voice note to someone who knows you. Not for advice — for company. Isolation makes sadness heavier than the sadness itself was.",
        source: "Behavioral activation",
      },
      {
        title: "Do one small thing that used to feel good",
        body: "Tea, a familiar album, a walk to the corner shop. You don't have to feel better first — action precedes mood, not the other way around.",
        source: "Behavioral activation, CBT",
      },
      {
        title: "Get the body out into daylight",
        body: "Even ten minutes outside, especially in the first hour after waking, anchors your circadian rhythm and lifts baseline mood across a few days. Sunglasses off if it's safe.",
        source: "Circadian research",
      },
      {
        title: "Sit with it without arguing",
        body: "Sadness handled gently passes faster than sadness fought. Set a timer for ten minutes, let the feeling have the room, then go do the next small thing.",
        source: "ACT",
      },
    ],
  },
  {
    slug: "angry",
    label: "Angry",
    emoji: "🔥",
    color: "tomato",
    blurb:
      "Anger is a signal that something matters — usually a boundary, a value, or an unmet need.",
    tips: [
      {
        title: "Wait 90 seconds before reacting",
        body: "The peak chemical surge of anger lasts roughly 90 seconds. If you can hold off — different room, count, breathe — what comes out next will be useful instead of expensive.",
        source: "Neuroscience (Jill Bolte Taylor)",
      },
      {
        title: "Cool the body to cool the mind",
        body: "Cold water on the face, a few seconds of ice on the wrists. The dive reflex pulls your heart rate down in seconds. The mind follows the body, not the other way around.",
        source: "DBT (TIP skill)",
      },
      {
        title: "Move the energy out physically",
        body: "Push-ups, fast walk, a hard scrub on a pan. Anger is mobilising energy looking for a target. Discharge some of it before you try to talk.",
        source: "Behavioral activation",
      },
      {
        title: "Find the value being stepped on",
        body: "Fairness? Respect? Honesty? Naming the underlying value turns reactive anger into a clean sentence you can actually say to someone.",
        source: "ACT, NVC",
      },
      {
        title: "Say what you actually want",
        body: "Beneath every angry outburst is a request. Name it: I want to be heard. I need an apology. I want this to stop. Anger without a request is just noise.",
        source: "Nonviolent Communication",
      },
      {
        title: "Don't send the message tonight",
        body: "Write it. Save the draft. Read it in the morning. Almost everything reads better with a night of distance — and most of the heat-of-the-moment lines are gone by breakfast.",
      },
    ],
  },
  {
    slug: "scared",
    label: "Scared",
    emoji: "🌑",
    color: "tomato",
    blurb:
      "Fear is concrete: there's a specific thing. That's actually good news — concrete is workable.",
    tips: [
      {
        title: "Name the worst that could realistically happen",
        body: "Write it down in one sentence. The named version is almost always smaller than the looming version. Specificity is the first move on fear.",
        source: "CBT",
      },
      {
        title: "Then name the most likely",
        body: "Fear inflates probability. The likeliest outcome is usually the boring middle, not the catastrophe. Hold both versions next to each other.",
        source: "CBT",
      },
      {
        title: "Picture yourself coping",
        body: "If the worst happened — what would you actually do? Phone whom, say what, find what. You'll find you have a response, and the fear quiets a little once you do.",
        source: "Stoic premeditatio",
      },
      {
        title: "Move toward the fear, slowly",
        body: "Stand at the edge of it for 30 seconds. Make the call. Open the document. Exposure shrinks fear — running grows it. The smallest possible step counts.",
        source: "Exposure therapy",
      },
      {
        title: "Tell someone what you're scared of",
        body: "Saying it out loud robs it of half its power. You don't need them to fix anything — you just need to stop carrying it alone.",
      },
      {
        title: "Look after the body first",
        body: "Slow breath, water, a snack, a walk. A scared body lies to a clear mind: it tells you everything is more dangerous than it is. Settle the body, then judge.",
      },
    ],
  },
  {
    slug: "overwhelmed",
    label: "Overwhelmed",
    emoji: "🌊",
    color: "pink",
    blurb:
      "Too many open loops at once. Working memory is full and the brain is throwing alarm bells.",
    tips: [
      {
        title: "Brain dump every loop onto paper",
        body: "Five minutes, no order. Get it all out of your head and onto a list. Most of the weight of overwhelm is the holding, not the doing.",
        source: "GTD (David Allen)",
      },
      {
        title: "Pick exactly one next physical action",
        body: "Not a project — the next thing you can do in ten minutes. \"Write the spec\" → \"open the doc and write the first sentence.\" Start there. The list will keep.",
        source: "GTD",
      },
      {
        title: "Move the list onto a calendar",
        body: "Open loops weigh more than scheduled commitments. \"Email Sarah\" → \"Wed 9am: email Sarah.\" Same task, different mass.",
      },
      {
        title: "Cancel or postpone exactly one thing",
        body: "You said yes to something you don't have capacity for. Pick the cheapest thing to push or drop, and do it now. The relief is immediate.",
        source: "Boundary work",
      },
      {
        title: "Five-minute clear-the-deck",
        body: "Tidy the desk, close 20 tabs, archive the inbox aggressively. Visible mess feeds invisible overwhelm — and a fast win re-arms the brain.",
        source: "Environmental design",
      },
      {
        title: "Practise no while it's small",
        body: "Say no to one new thing today. Overwhelm is downstream of overcommitment, and overcommitment is downstream of a no muscle that wasn't trained.",
      },
    ],
  },
  {
    slug: "tired",
    label: "Tired",
    emoji: "🪫",
    color: "orange",
    blurb:
      "Energy is depleted. Could be water, food, sleep debt, sun, or all four. Almost always physiological before existential.",
    tips: [
      {
        title: "Drink a glass of water before anything else",
        body: "Mild dehydration tanks energy and concentration. Water first, then judge how tired you actually are. The number of times this is the whole answer is embarrassing.",
      },
      {
        title: "Eat something with protein",
        body: "Tired-from-nothing is often tired-from-low-blood-sugar. Eggs, nuts, yoghurt, leftovers. Sugar gives you ten good minutes and an hour of tax.",
      },
      {
        title: "Get outside for five minutes",
        body: "Direct daylight in the eyes — sunglasses off, no glass between — is the strongest non-pharmacological alertness boost we know of. Five minutes is enough to notice.",
        source: "Circadian research",
      },
      {
        title: "Move, briefly",
        body: "Counterintuitive: a tired body usually needs a five-minute walk more than another twenty minutes on the sofa. Movement is the cheapest stimulant.",
        source: "Exercise psychology",
      },
      {
        title: "Twenty-minute nap, not longer",
        body: "Short naps are restorative; longer daytime naps usually leave you worse. Set a timer. Lie flat. Even resting eyes-closed beats nothing.",
        source: "Sleep research",
      },
      {
        title: "Audit the obvious",
        body: "Alcohol last night, caffeine after 2pm, screens until midnight, a bad week of sleep. Tiredness today is paid yesterday — and the receipt is usually visible.",
      },
    ],
  },
  {
    slug: "lonely",
    label: "Lonely",
    emoji: "🌙",
    color: "green",
    blurb:
      "Loneliness is a hunger signal for connection. It is not evidence that nobody cares about you.",
    tips: [
      {
        title: "Send a low-stakes message to one person",
        body: "Not \"how are you?\" — something specific. \"This made me think of you.\" \"Remember when…\" Specificity invites a real reply.",
      },
      {
        title: "Make the first move",
        body: "Almost everyone is waiting for the other person to reach out first. Be the one who breaks the stalemate; nine times in ten the other side is glad you did.",
      },
      {
        title: "Be near other humans, even silently",
        body: "Café, library, park bench, gym. Ambient social presence reduces loneliness without a single conversation. The body counts the bodies around it.",
        source: "Social neuroscience",
      },
      {
        title: "Help someone with something small",
        body: "Loneliness shrinks when you do something for another person. Reply to that question on the group chat. Recommend a book. Drop off the thing you said you'd lend.",
        source: "Behavioral activation",
      },
      {
        title: "Put a real thing on the calendar this week",
        body: "A confirmed dinner three days out does almost as much for loneliness today as the dinner itself. Anticipation is half the cure.",
      },
      {
        title: "Audit your inputs",
        body: "Doomscrolling and parasocial feeds amplify loneliness. Swap thirty minutes of feed for thirty minutes of phone, voice note, or coffee. Not the same nutrient.",
        source: "Digital well-being research",
      },
    ],
  },
  {
    slug: "ashamed",
    label: "Ashamed",
    emoji: "🌫",
    color: "purple",
    blurb:
      "Shame says \"I am bad,\" not \"I did a bad thing.\" It thrives in secrecy and shrinks in honesty.",
    tips: [
      {
        title: "Tell one trusted person",
        body: "Shame loses most of its grip when spoken out loud to someone safe. You don't need advice — you need to be heard without flinching.",
        source: "Brené Brown, shame research",
      },
      {
        title: "Separate the behavior from you",
        body: "Did you do something you regret? That's guilt, and it's actionable. Repair what you can. You are not the worst thing you've ever done.",
        source: "Self-compassion (Kristin Neff)",
      },
      {
        title: "Talk to yourself like a friend",
        body: "Notice the inner monologue. Would you say that to someone you love? If not, the script is wrong, not you. Replace one sentence at a time.",
        source: "Self-compassion",
      },
      {
        title: "Try the friend test",
        body: "If a friend told you they had done this exact thing, would you shame them? Almost certainly not. The double standard is the bug.",
      },
      {
        title: "Don't isolate",
        body: "Shame whispers \"hide.\" Hiding deepens it. Even an hour around someone safe — even silent, even bored — quiets the voice.",
      },
      {
        title: "Make one small repair if there is one to make",
        body: "If shame is pointing at a real action, take a small repair step today: an apology, a return, a clarification. Then let yourself move forward.",
        source: "ACT",
      },
    ],
  },
  {
    slug: "guilty",
    label: "Guilty",
    emoji: "🪨",
    color: "pink",
    blurb:
      "Guilt is about action, not identity. Healthy guilt motivates a repair; the rest is friction.",
    tips: [
      {
        title: "Name what you did, simply",
        body: "Out loud or on paper, in one sentence. \"I forgot Anna's birthday.\" Specificity tames the spiral that vague guilt spins forever.",
      },
      {
        title: "Apologise cleanly, no excuses",
        body: "\"I'm sorry I did X. It was wrong. I'll do Y.\" No \"but I was…\" The excuse undoes the apology before it lands.",
        source: "Repair work",
      },
      {
        title: "Make a small concrete repair",
        body: "A card, a redo, a returned item, an early reply. Action is the antidote to guilt — rumination is its multiplier.",
      },
      {
        title: "Tell guilt and over-guilt apart",
        body: "Proportional guilt motivates repair and then leaves. Disproportionate guilt loops without action. If you've done the repair, the rest is just self-punishment.",
        source: "CBT",
      },
      {
        title: "Take the lesson, drop the verdict",
        body: "What specifically would you do differently next time? That's the value of guilt; the rest is friction. Carry the lesson, set the rest down.",
      },
      {
        title: "Forgive yourself when the work is done",
        body: "Holding more guilt after the repair helps no one — least of all the person you wronged. Letting yourself off is part of the deal.",
      },
    ],
  },
  {
    slug: "jealous",
    label: "Jealous",
    emoji: "🪞",
    color: "teal",
    blurb:
      "Jealousy is a wonky compass — it points at what you want. Read it, then put it down.",
    tips: [
      {
        title: "Read it as data: \"I want that too\"",
        body: "Jealousy points to a value of yours. What is it pointing at — money, recognition, freedom, intimacy, mastery? Naming that turns the feeling into information.",
        source: "ACT",
      },
      {
        title: "Mute them for a week",
        body: "Algorithmic comparison feeds the loop. A seven-day mute (no unfollow, no drama) is usually enough to remember they are not your reference class.",
      },
      {
        title: "Note what you don't see",
        body: "Every highlight reel hides a private mess. Their flat stomach hides the back ache, the late nights, the fight they had at breakfast. The comparison was rigged from the start.",
      },
      {
        title: "Make a tiny move toward the thing you want",
        body: "Apply, message, draft, sign up. Action shrinks envy fast; rumination grows it. Don't aim for the whole staircase — just the first step today.",
      },
      {
        title: "Say it out loud to someone safe",
        body: "\"I'm jealous of X.\" Naming jealousy almost immediately makes it smaller. The feeling thrives on being unspeakable; speak it.",
      },
      {
        title: "Be glad for them, even badly",
        body: "Practise it. The capacity to feel real happiness for someone else is a muscle, and it's the one that ends jealousy permanently.",
      },
    ],
  },
  {
    slug: "stuck",
    label: "Stuck",
    emoji: "⚓",
    color: "yellow",
    blurb:
      "Either the next step is unclear, or you've outgrown the current path. Both are addressable.",
    tips: [
      {
        title: "Write the bad version",
        body: "Whatever you're avoiding, do it badly. A terrible draft, a rough sketch, a sloppy email. Editing is much easier than starting, and the bad version unblocks the good one.",
        source: "Anne Lamott, \"shitty first drafts\"",
      },
      {
        title: "Set a 25-minute timer, one thing only",
        body: "No tabs, no phone. When the timer ends you can stop. Often you won't want to — momentum is the rare commodity, and the timer is how you buy it.",
        source: "Pomodoro / time-boxing",
      },
      {
        title: "Make the step embarrassingly small",
        body: "If \"go for a run\" feels impossible, put on running shoes. Just that. The smaller the activation energy, the more reliably you actually move.",
        source: "Tiny Habits (BJ Fogg)",
      },
      {
        title: "Talk it out to a wall",
        body: "Explain the problem aloud as if to a smart friend. Half the time the explaining solves it. Rubber-duck debugging works for life, not just code.",
      },
      {
        title: "Change the room, even briefly",
        body: "Stuck mind, new desk. New chair, new café, new park bench. The body context-switches faster than the head, and the head usually follows.",
      },
      {
        title: "Ask what would change with permission",
        body: "Often \"stuck\" is permission, not capability. What's the move you'd make if no one was watching, judging, or measuring? Start there.",
        source: "ACT",
      },
    ],
  },
  {
    slug: "bored",
    label: "Bored",
    emoji: "⏸",
    color: "teal",
    blurb:
      "Boredom is a signal, not a problem. Your brain is telling you the current activity isn't worth its compute.",
    tips: [
      {
        title: "Don't reach for the phone",
        body: "Boredom dissolves under stimulation, but the next-day wisdom dissolves with it. Sit with the empty for five minutes first. The interesting thoughts are on the other side.",
      },
      {
        title: "Make something, however bad",
        body: "Write a list, sketch a face, sing a tune, build a thing. Production beats consumption for boredom every time — even small production.",
      },
      {
        title: "Pick the thing you've been avoiding",
        body: "Boredom often masks a small unfinished task. The email, the dish, the message, the form. Five minutes of friction now, an hour of relief after.",
      },
      {
        title: "Switch the sense you're using",
        body: "Too much screen, not enough body? Cook. Walk. Stretch. Different sensory channel resets the brain better than another tab does.",
      },
      {
        title: "Look upstream if it's chronic",
        body: "Persistent boredom is usually under-challenge or over-numbness. What's the next-too-hard project you'd actually love? Boredom points at that absence.",
      },
    ],
  },
  {
    slug: "numb",
    label: "Numb",
    emoji: "⚪",
    color: "blue",
    blurb:
      "Disconnect, often after too much for too long. The way back in is through the body, gently.",
    tips: [
      {
        title: "Sensory ground first",
        body: "Cold water on the face, a strong-smelling tea, a textured object held in both hands. Drag the body back online before you ask the head anything.",
        source: "DBT (TIP skill)",
      },
      {
        title: "Move slowly outside",
        body: "Ten minutes of walking with no headphones. Let the world arrive gradually — the colours, the air, the sounds. Don't try to feel anything in particular.",
      },
      {
        title: "Eat something warm",
        body: "Soup, tea, porridge, anything warm and gentle. Warmth signals safety to the nervous system in a way nothing in your head can argue with.",
      },
      {
        title: "Tell one person you're feeling numb",
        body: "Naming it externalises it, even if they don't understand. The point isn't them solving — it's you not carrying the weird alone.",
      },
      {
        title: "Don't force feelings",
        body: "If joy or sadness or anger doesn't come up on demand, fine. Forcing emotion deepens the dissociation. Let the thaw be slow.",
        source: "Trauma-informed work",
      },
      {
        title: "If it lasts, get proper support",
        body: "A few days of numbness is normal after something hard. Weeks of it is worth a real conversation with a therapist or doctor — not a sign of weakness, just of reach.",
      },
    ],
  },
  {
    slug: "restless",
    label: "Restless",
    emoji: "⚡",
    color: "orange",
    blurb:
      "Energy looking for a target. Often the body wanting out and the head wanting in.",
    tips: [
      {
        title: "Move first, decide later",
        body: "Twenty minutes of movement — walk, run, bike, dance. Don't try to figure out what you're restless about until the body has discharged some of it.",
        source: "Exercise psychology",
      },
      {
        title: "Reduce stimulation, not increase it",
        body: "Restless people reach for more inputs (more scrolling, more snacking, more tabs). Try the opposite: thirty minutes of nothing. Phone in another room.",
        source: "Attention research",
      },
      {
        title: "Pick a small reset",
        body: "Kitchen, garage, inbox, drawer. Restlessness loves an environment-tidy with a visible result in twenty minutes. The hands solve what the head can't.",
      },
      {
        title: "Point it at the project that's been waiting",
        body: "Restlessness is good fuel if pointed at something. The garage, the half-written thing, the conversation you've been postponing. The energy will be gone tomorrow; spend it now.",
        source: "Behavioral activation",
      },
      {
        title: "Don't book big decisions tonight",
        body: "Restlessness produces \"I should change everything\" impulses. Wait until morning before quitting the job, breaking up, or buying the ticket.",
      },
      {
        title: "Check the basics",
        body: "Caffeine after 2pm? Skipped a meal? Slept under seven hours? Restlessness is often physiological before it's existential.",
      },
    ],
  },
  {
    slug: "proud",
    label: "Proud",
    emoji: "🏵",
    color: "yellow",
    blurb:
      "Pride is metabolism for the win. Savour it deliberately — it lasts longer with attention.",
    tips: [
      {
        title: "Say what you did, out loud",
        body: "Name the specific thing. \"I shipped X. I finished Y. I navigated Z.\" The act of naming locks the win in — un-named wins fade by Tuesday.",
        source: "Savoring research",
      },
      {
        title: "Tell someone who'll be glad for you",
        body: "Pride shared compounds; pride hidden fades. Pick a friend who can take it without flinching, and give them the chance to be glad with you.",
      },
      {
        title: "Write down what made it possible",
        body: "Skill, luck, support, persistence — list them. Naming the inputs makes the next attempt more confident, and gives the people who helped a place to live in your story.",
      },
      {
        title: "Don't immediately set a bigger goal",
        body: "Twenty-four hours of resting on the win is not laziness, it's metabolism. The next thing will still be there tomorrow.",
      },
      {
        title: "Mark it somewhere small but real",
        body: "A note in a journal, a screenshot in a folder, a candle, a meal out. A future-you will need the receipt on a Tuesday.",
      },
      {
        title: "Notice the body",
        body: "Pride has a posture. Stand a little taller. Let the shoulders drop back. The body learns from the win as much as the head does.",
      },
    ],
  },
  {
    slug: "hopeful",
    label: "Hopeful",
    emoji: "🌱",
    color: "green",
    blurb:
      "Hope is fragile fuel. Spend it on action this week or it evaporates.",
    tips: [
      {
        title: "Channel it into one concrete next step today",
        body: "Email, call, draft, sign up, tell. Hope without action withers within days. The smallest motion locks it into reality before the doubt comes back.",
      },
      {
        title: "Tell someone what you hope for",
        body: "Said out loud, hope quietly becomes commitment. Tell one person who won't trample it — that part matters.",
      },
      {
        title: "Picture the working version specifically",
        body: "Three months out, six months, a year. Specific images, not abstractions. \"My day looks like this. I am doing X with Y people.\" Vague hopes don't pull; specific ones do.",
      },
      {
        title: "Inventory what's already true",
        body: "Hope often misses how much is already in place. List what's already done, already learned, already lined up. Many projects are 80% there before you noticed.",
      },
      {
        title: "Plan for the wobble",
        body: "Hope dips on Tuesdays. Decide now what you'll do when the dip comes — re-read this list, call a friend, walk an hour. Plans beat willpower.",
      },
      {
        title: "Don't share it with someone who'll trample it",
        body: "Even well-meaning skeptics can hose a young hope. Protect the seedling for now; show people once it's a stem.",
      },
    ],
  },
];

export function findFeeling(slug: string): Feeling | undefined {
  return feelings.find((f) => f.slug === slug);
}
