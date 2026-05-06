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
  tips: Tip[];
};

/**
 * Tips draw on CBT, behavioral activation, ACT, sleep/exercise research, and
 * cognitive science. Sources are short labels meant to signal lineage, not
 * citations. Keep tips short, concrete, and actionable.
 */
export const feelings: Feeling[] = [
  {
    slug: "anxious",
    label: "Anxious",
    emoji: "🌀",
    blurb: "Your nervous system is bracing for a threat that may or may not be real.",
    tips: [
      {
        title: "Slow your exhale, not your inhale",
        body: "Breathe in for 4 seconds, then exhale for 6–8. The long out-breath activates your parasympathetic nervous system. Repeat for 90 seconds.",
        source: "Vagal tone research",
      },
      {
        title: "Name three things you can see, two you can hear, one you can touch",
        body: "This is grounding through the senses. It pulls attention out of catastrophic thinking and back into the room.",
        source: "Trauma-informed CBT",
      },
      {
        title: "Write the worry down, then schedule it",
        body: "On paper: what specifically am I afraid of? Pick a 15-minute slot tomorrow to think about it. Until then, you have permission to set it aside.",
        source: "Worry postponement, CBT",
      },
      {
        title: "Move for ten minutes",
        body: "Brisk walking, stairs, anything that gets your heart rate up. Anxiety is partly stuck physical energy. Burning some of it changes your state.",
        source: "Behavioral activation",
      },
    ],
  },
  {
    slug: "sad",
    label: "Sad",
    emoji: "🌧",
    blurb: "Sadness slows you down so you can process loss or change. It usually wants company more than fixing.",
    tips: [
      {
        title: "Reach out to one person, even briefly",
        body: "A 30-second voice note to someone who knows you. Not for advice — for connection. Isolation makes sadness heavier.",
        source: "Behavioral activation",
      },
      {
        title: "Do one small thing that used to feel good",
        body: "Make tea, put on a familiar album, go to a café you like. You don't need to feel better first — action precedes mood, not the other way around.",
        source: "Behavioral activation, CBT",
      },
      {
        title: "Get sunlight on your face within an hour of waking",
        body: "10 minutes outside — even on a cloudy day — anchors your circadian rhythm and lifts baseline mood over a few days.",
        source: "Circadian / sleep research",
      },
      {
        title: "Let yourself feel it without arguing with it",
        body: "Sadness handled gently passes faster than sadness fought. Set a timer for 10 minutes, sit with it, then move on to the next small thing.",
        source: "ACT",
      },
    ],
  },
  {
    slug: "angry",
    label: "Angry",
    emoji: "🔥",
    blurb: "Anger is a signal that something matters — usually a boundary, a value, or an unmet need.",
    tips: [
      {
        title: "Wait 90 seconds before reacting",
        body: "The peak chemical surge of anger lasts roughly 90 seconds. If you can hold off — walk to the other room, count, breathe — you'll respond from a clearer place.",
        source: "Neuroscience (Jill Bolte Taylor)",
      },
      {
        title: "Move the energy out physically",
        body: "Push-ups, fast walk, throw a ball, scrub a pan hard. Anger is mobilizing energy. Discharge it before you try to talk.",
        source: "Behavioral activation",
      },
      {
        title: "Ask: what value of mine is being stepped on?",
        body: "Fairness? Respect? Honesty? Naming the underlying value turns reactive anger into clear communication you can actually use.",
        source: "ACT, NVC",
      },
      {
        title: "Don't send the message tonight",
        body: "Write it. Save the draft. Read it in the morning. Almost everything reads better with a night of distance.",
        source: "Folk wisdom + CBT",
      },
    ],
  },
  {
    slug: "overwhelmed",
    label: "Overwhelmed",
    emoji: "🌊",
    blurb: "Too many open loops at once. Working memory is full and your brain is throwing alarm bells.",
    tips: [
      {
        title: "Brain dump every open loop onto paper",
        body: "Five minutes, no order. Get it all out of your head and onto a list. Most of the weight of overwhelm is the holding, not the doing.",
        source: "GTD (David Allen)",
      },
      {
        title: "Pick exactly one next physical action",
        body: "Not a project — the next thing you can do in 10 minutes. \"Write spec\" → \"Open doc and write the first sentence.\" Start there.",
        source: "GTD",
      },
      {
        title: "Cancel or postpone one thing",
        body: "You probably said yes to something you don't have capacity for. Pick the lowest-cost thing to push or drop and do it now.",
        source: "Boundary setting",
      },
      {
        title: "Do a 5-minute clear-the-deck",
        body: "Tidy your desk, close 20 tabs, clear your inbox to zero by archiving aggressively. Visible mess feeds invisible overwhelm.",
        source: "Environmental design",
      },
    ],
  },
  {
    slug: "lonely",
    label: "Lonely",
    emoji: "🌙",
    blurb: "Loneliness is a hunger signal for connection, not evidence that nobody cares about you.",
    tips: [
      {
        title: "Send a low-stakes message to one person",
        body: "Not \"how are you?\" — something specific. \"This made me think of you.\" \"Remember when…\" Specificity invites a real reply.",
        source: "Connection research",
      },
      {
        title: "Be near other humans, even silently",
        body: "Work from a café, take a class, sit in a park. Ambient social presence reduces loneliness even without conversation.",
        source: "Social neuroscience",
      },
      {
        title: "Help someone with something small",
        body: "Loneliness shrinks when you do something for another person. Reply to that question on the group chat. Recommend a book to a friend.",
        source: "Behavioral activation",
      },
      {
        title: "Audit your inputs",
        body: "Doomscrolling, parasocial feeds, and algorithmic comparison amplify loneliness. Replace 30 minutes of feed with 30 minutes of real contact, even by phone.",
        source: "Digital well-being research",
      },
    ],
  },
  {
    slug: "stuck",
    label: "Stuck",
    emoji: "⚓",
    blurb: "Either the next step is unclear, or you've outgrown the current path. Both are addressable.",
    tips: [
      {
        title: "Write the bad version",
        body: "Whatever you're avoiding, do it badly. A terrible draft, a rough sketch, a sloppy email. Editing is easier than starting.",
        source: "Anne Lamott, \"shitty first drafts\"",
      },
      {
        title: "Set a 25-minute timer and only work on one thing",
        body: "No tabs, no phone. When the timer ends you can stop. Often you won't want to.",
        source: "Pomodoro / time-boxing",
      },
      {
        title: "Make the step smaller until it's embarrassing",
        body: "If \"go for a run\" feels impossible, put on running shoes. Just that. The smaller the activation energy, the more reliably you actually move.",
        source: "Tiny Habits (BJ Fogg)",
      },
      {
        title: "Ask: what would change if I gave myself permission?",
        body: "Often \"stuck\" is permission, not capability. What's the move you'd make if no one was watching, judging, or measuring?",
        source: "ACT",
      },
    ],
  },
  {
    slug: "restless",
    label: "Restless",
    emoji: "⚡",
    blurb: "Energy looking for a target. Often a sign you've been sedentary, overstimulated, or undercommitted.",
    tips: [
      {
        title: "Move first, decide later",
        body: "20 minutes of movement — walk, run, bike, dance. Don't try to figure out what you're restless about until your body has discharged some of it.",
        source: "Exercise psychology",
      },
      {
        title: "Reduce stimulation, not increase it",
        body: "Restless people often add more inputs (more scrolling, more snacking). Try the opposite: 30 minutes of nothing — no phone, no screen, no podcast.",
        source: "Attention research",
      },
      {
        title: "Pick a project that's been waiting",
        body: "Restlessness is good fuel if pointed at something. The garage. The half-written thing. The conversation you've been postponing.",
        source: "Behavioral activation",
      },
      {
        title: "Check the basics",
        body: "Caffeine after 2pm? Skipped a meal? Slept under 7 hours? Restlessness is often physiological before it's existential.",
        source: "Sleep / nutrition basics",
      },
    ],
  },
  {
    slug: "ashamed",
    label: "Ashamed",
    emoji: "🌫",
    blurb: "Shame says \"I am bad,\" not \"I did a bad thing.\" It thrives in secrecy and shrinks in honesty.",
    tips: [
      {
        title: "Tell one trusted person",
        body: "Shame loses most of its grip when spoken out loud to someone safe. You don't need advice — you need to be heard without flinching.",
        source: "Brené Brown, shame research",
      },
      {
        title: "Separate behavior from identity",
        body: "Did you do something you regret? That's guilt, and it's actionable. Repair what you can. You are not the worst thing you've done.",
        source: "Self-compassion (Kristin Neff)",
      },
      {
        title: "Speak to yourself the way you'd speak to a friend",
        body: "Notice the inner monologue. Would you say that to someone you love? If not, the script is wrong, not you.",
        source: "Self-compassion",
      },
      {
        title: "Make one small repair if there is one to make",
        body: "If shame is pointing at a real action, take a small repair step today: an apology, a return, a clarification. Then let yourself move forward.",
        source: "ACT",
      },
    ],
  },
];

export function findFeeling(slug: string): Feeling | undefined {
  return feelings.find((f) => f.slug === slug);
}
