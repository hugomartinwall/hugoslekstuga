export type EmojiEntry = {
  char: string;
  name: string;
  keywords: string[];
  category: Category;
};

export type Category =
  | "smileys"
  | "people"
  | "love"
  | "animals"
  | "food"
  | "travel"
  | "activity"
  | "objects"
  | "nature"
  | "symbols";

export const CATEGORIES: { id: Category; label: string }[] = [
  { id: "smileys", label: "Smileys" },
  { id: "people", label: "People" },
  { id: "love", label: "Love" },
  { id: "animals", label: "Animals" },
  { id: "food", label: "Food" },
  { id: "travel", label: "Travel" },
  { id: "activity", label: "Activity" },
  { id: "objects", label: "Objects" },
  { id: "nature", label: "Nature" },
  { id: "symbols", label: "Symbols" },
];

// Curated set of commonly-used emojis. Not exhaustive — quality over quantity.
export const EMOJIS: EmojiEntry[] = [
  // Smileys
  { char: "😀", name: "grinning face", keywords: ["happy", "smile", "grin"], category: "smileys" },
  { char: "😃", name: "smile", keywords: ["happy", "joy", "smile"], category: "smileys" },
  { char: "😄", name: "big smile", keywords: ["happy", "grin", "joy"], category: "smileys" },
  { char: "😁", name: "beaming face", keywords: ["smile", "grin", "happy"], category: "smileys" },
  { char: "😆", name: "laughing", keywords: ["laugh", "happy"], category: "smileys" },
  { char: "😅", name: "sweat smile", keywords: ["nervous", "phew", "relief"], category: "smileys" },
  { char: "🤣", name: "rofl", keywords: ["laughing", "rolling", "lol"], category: "smileys" },
  { char: "😂", name: "tears of joy", keywords: ["laugh", "cry", "happy"], category: "smileys" },
  { char: "🙂", name: "slight smile", keywords: ["smile", "ok"], category: "smileys" },
  { char: "🙃", name: "upside down", keywords: ["sarcastic", "joke", "irony"], category: "smileys" },
  { char: "😉", name: "winking", keywords: ["wink", "flirt", "playful"], category: "smileys" },
  { char: "😊", name: "smiling eyes", keywords: ["happy", "blush", "sweet"], category: "smileys" },
  { char: "🥲", name: "smiling tear", keywords: ["proud", "touched", "bittersweet"], category: "smileys" },
  { char: "😇", name: "halo", keywords: ["angel", "innocent", "good"], category: "smileys" },
  { char: "😍", name: "heart eyes", keywords: ["love", "crush", "adore"], category: "smileys" },
  { char: "🥰", name: "loving", keywords: ["love", "hearts", "adore"], category: "smileys" },
  { char: "😘", name: "kiss", keywords: ["kiss", "love", "blow"], category: "smileys" },
  { char: "🤩", name: "star eyes", keywords: ["wow", "excited", "starstruck"], category: "smileys" },
  { char: "😎", name: "cool", keywords: ["cool", "sunglasses", "chill"], category: "smileys" },
  { char: "🤓", name: "nerd", keywords: ["nerd", "smart", "study"], category: "smileys" },
  { char: "🤔", name: "thinking", keywords: ["think", "hmm", "ponder"], category: "smileys" },
  { char: "🫡", name: "salute", keywords: ["respect", "yes sir", "okay"], category: "smileys" },
  { char: "😶", name: "no mouth", keywords: ["silent", "speechless"], category: "smileys" },
  { char: "😐", name: "neutral", keywords: ["meh", "blank", "okay"], category: "smileys" },
  { char: "😬", name: "grimace", keywords: ["awkward", "yikes"], category: "smileys" },
  { char: "🙄", name: "eye roll", keywords: ["annoyed", "whatever"], category: "smileys" },
  { char: "😴", name: "sleeping", keywords: ["sleep", "tired", "zzz"], category: "smileys" },
  { char: "🤯", name: "mind blown", keywords: ["shocked", "wow", "exploding"], category: "smileys" },
  { char: "🥵", name: "hot face", keywords: ["hot", "sweat", "warm"], category: "smileys" },
  { char: "🥶", name: "cold face", keywords: ["cold", "freezing", "chill"], category: "smileys" },
  { char: "🥺", name: "pleading", keywords: ["please", "puppy eyes", "begging"], category: "smileys" },
  { char: "😭", name: "loudly crying", keywords: ["cry", "sad", "tears"], category: "smileys" },
  { char: "😅", name: "sweat smile", keywords: ["phew", "relief", "nervous"], category: "smileys" },
  { char: "😡", name: "angry", keywords: ["mad", "rage", "anger"], category: "smileys" },
  { char: "🤗", name: "hug", keywords: ["hug", "embrace", "warm"], category: "smileys" },
  { char: "😳", name: "flushed", keywords: ["embarrassed", "shy", "blush"], category: "smileys" },
  { char: "🤝", name: "handshake", keywords: ["deal", "agreement", "shake"], category: "smileys" },

  // People
  { char: "👋", name: "wave", keywords: ["hi", "bye", "hello"], category: "people" },
  { char: "👍", name: "thumbs up", keywords: ["yes", "ok", "good", "approve"], category: "people" },
  { char: "👎", name: "thumbs down", keywords: ["no", "bad", "disapprove"], category: "people" },
  { char: "👌", name: "ok", keywords: ["fine", "perfect", "nice"], category: "people" },
  { char: "🤞", name: "fingers crossed", keywords: ["luck", "hope"], category: "people" },
  { char: "✌️", name: "peace", keywords: ["peace", "victory", "two"], category: "people" },
  { char: "🤘", name: "rock on", keywords: ["rock", "metal", "horns"], category: "people" },
  { char: "👏", name: "clap", keywords: ["applause", "clap", "good job"], category: "people" },
  { char: "🙌", name: "raised hands", keywords: ["yay", "celebration", "praise"], category: "people" },
  { char: "🙏", name: "pray", keywords: ["please", "thanks", "prayer"], category: "people" },
  { char: "💪", name: "muscle", keywords: ["strong", "flex", "power"], category: "people" },
  { char: "🧠", name: "brain", keywords: ["smart", "think", "mind"], category: "people" },
  { char: "👀", name: "eyes", keywords: ["look", "watching", "see"], category: "people" },

  // Love
  { char: "❤️", name: "red heart", keywords: ["love", "red", "heart"], category: "love" },
  { char: "🧡", name: "orange heart", keywords: ["love", "orange"], category: "love" },
  { char: "💛", name: "yellow heart", keywords: ["love", "yellow"], category: "love" },
  { char: "💚", name: "green heart", keywords: ["love", "green"], category: "love" },
  { char: "💙", name: "blue heart", keywords: ["love", "blue"], category: "love" },
  { char: "💜", name: "purple heart", keywords: ["love", "purple"], category: "love" },
  { char: "🖤", name: "black heart", keywords: ["love", "black"], category: "love" },
  { char: "🤍", name: "white heart", keywords: ["love", "white"], category: "love" },
  { char: "💔", name: "broken heart", keywords: ["sad", "breakup", "heartbreak"], category: "love" },
  { char: "❣️", name: "heart exclamation", keywords: ["love", "emphasis"], category: "love" },
  { char: "💕", name: "two hearts", keywords: ["love", "hearts"], category: "love" },
  { char: "💖", name: "sparkle heart", keywords: ["love", "sparkle"], category: "love" },
  { char: "💗", name: "growing heart", keywords: ["love", "growing"], category: "love" },
  { char: "💘", name: "heart arrow", keywords: ["love", "cupid", "arrow"], category: "love" },
  { char: "💝", name: "heart gift", keywords: ["love", "gift", "ribbon"], category: "love" },

  // Animals
  { char: "🐶", name: "dog", keywords: ["dog", "puppy", "pet"], category: "animals" },
  { char: "🐱", name: "cat", keywords: ["cat", "kitten", "pet"], category: "animals" },
  { char: "🐭", name: "mouse", keywords: ["mouse", "small"], category: "animals" },
  { char: "🐹", name: "hamster", keywords: ["hamster", "pet"], category: "animals" },
  { char: "🐰", name: "rabbit", keywords: ["bunny", "rabbit"], category: "animals" },
  { char: "🦊", name: "fox", keywords: ["fox"], category: "animals" },
  { char: "🐻", name: "bear", keywords: ["bear"], category: "animals" },
  { char: "🐼", name: "panda", keywords: ["panda"], category: "animals" },
  { char: "🦁", name: "lion", keywords: ["lion"], category: "animals" },
  { char: "🐮", name: "cow", keywords: ["cow"], category: "animals" },
  { char: "🐷", name: "pig", keywords: ["pig"], category: "animals" },
  { char: "🐸", name: "frog", keywords: ["frog"], category: "animals" },
  { char: "🐵", name: "monkey", keywords: ["monkey"], category: "animals" },
  { char: "🐔", name: "chicken", keywords: ["chicken", "bird"], category: "animals" },
  { char: "🐧", name: "penguin", keywords: ["penguin", "bird"], category: "animals" },
  { char: "🦉", name: "owl", keywords: ["owl", "wise"], category: "animals" },
  { char: "🦄", name: "unicorn", keywords: ["unicorn", "magic"], category: "animals" },
  { char: "🐝", name: "bee", keywords: ["bee", "busy"], category: "animals" },
  { char: "🦋", name: "butterfly", keywords: ["butterfly"], category: "animals" },
  { char: "🐢", name: "turtle", keywords: ["turtle", "slow"], category: "animals" },
  { char: "🐙", name: "octopus", keywords: ["octopus"], category: "animals" },
  { char: "🐬", name: "dolphin", keywords: ["dolphin"], category: "animals" },
  { char: "🐳", name: "whale", keywords: ["whale"], category: "animals" },

  // Food
  { char: "🍎", name: "apple", keywords: ["apple", "fruit"], category: "food" },
  { char: "🍊", name: "orange", keywords: ["orange", "fruit"], category: "food" },
  { char: "🍌", name: "banana", keywords: ["banana", "fruit"], category: "food" },
  { char: "🍉", name: "watermelon", keywords: ["watermelon", "fruit"], category: "food" },
  { char: "🍇", name: "grapes", keywords: ["grapes", "fruit"], category: "food" },
  { char: "🍓", name: "strawberry", keywords: ["strawberry", "fruit"], category: "food" },
  { char: "🍒", name: "cherries", keywords: ["cherry", "fruit"], category: "food" },
  { char: "🥑", name: "avocado", keywords: ["avocado"], category: "food" },
  { char: "🥕", name: "carrot", keywords: ["carrot", "vegetable"], category: "food" },
  { char: "🌽", name: "corn", keywords: ["corn"], category: "food" },
  { char: "🥦", name: "broccoli", keywords: ["broccoli"], category: "food" },
  { char: "🍞", name: "bread", keywords: ["bread"], category: "food" },
  { char: "🥐", name: "croissant", keywords: ["croissant", "bread"], category: "food" },
  { char: "🧀", name: "cheese", keywords: ["cheese"], category: "food" },
  { char: "🍕", name: "pizza", keywords: ["pizza"], category: "food" },
  { char: "🍔", name: "burger", keywords: ["burger", "hamburger"], category: "food" },
  { char: "🍟", name: "fries", keywords: ["fries", "chips"], category: "food" },
  { char: "🌮", name: "taco", keywords: ["taco", "mexican"], category: "food" },
  { char: "🍣", name: "sushi", keywords: ["sushi", "japanese"], category: "food" },
  { char: "🍩", name: "donut", keywords: ["donut", "doughnut"], category: "food" },
  { char: "🍪", name: "cookie", keywords: ["cookie"], category: "food" },
  { char: "🎂", name: "birthday cake", keywords: ["cake", "birthday"], category: "food" },
  { char: "🍰", name: "cake", keywords: ["cake", "dessert"], category: "food" },
  { char: "🍫", name: "chocolate", keywords: ["chocolate"], category: "food" },
  { char: "🍿", name: "popcorn", keywords: ["popcorn", "movie"], category: "food" },
  { char: "☕️", name: "coffee", keywords: ["coffee", "drink"], category: "food" },
  { char: "🍵", name: "tea", keywords: ["tea", "drink"], category: "food" },
  { char: "🍷", name: "wine", keywords: ["wine"], category: "food" },
  { char: "🍺", name: "beer", keywords: ["beer"], category: "food" },
  { char: "🥤", name: "cup with straw", keywords: ["soda", "drink"], category: "food" },

  // Travel
  { char: "🚗", name: "car", keywords: ["car", "drive"], category: "travel" },
  { char: "🚕", name: "taxi", keywords: ["taxi", "cab"], category: "travel" },
  { char: "🚌", name: "bus", keywords: ["bus"], category: "travel" },
  { char: "🚲", name: "bike", keywords: ["bike", "bicycle"], category: "travel" },
  { char: "🛴", name: "scooter", keywords: ["scooter"], category: "travel" },
  { char: "✈️", name: "plane", keywords: ["plane", "airplane", "travel"], category: "travel" },
  { char: "🚀", name: "rocket", keywords: ["rocket", "launch", "space"], category: "travel" },
  { char: "⛵️", name: "sailboat", keywords: ["sailboat", "boat"], category: "travel" },
  { char: "🚤", name: "speedboat", keywords: ["boat", "speedboat"], category: "travel" },
  { char: "🚂", name: "train", keywords: ["train"], category: "travel" },
  { char: "🏠", name: "house", keywords: ["house", "home"], category: "travel" },
  { char: "🏖️", name: "beach", keywords: ["beach", "vacation"], category: "travel" },
  { char: "⛰️", name: "mountain", keywords: ["mountain"], category: "travel" },
  { char: "🗽", name: "statue of liberty", keywords: ["new york", "usa"], category: "travel" },
  { char: "🗼", name: "tokyo tower", keywords: ["tokyo"], category: "travel" },

  // Activity
  { char: "⚽️", name: "soccer", keywords: ["soccer", "football"], category: "activity" },
  { char: "🏀", name: "basketball", keywords: ["basketball"], category: "activity" },
  { char: "🎾", name: "tennis", keywords: ["tennis"], category: "activity" },
  { char: "🎲", name: "dice", keywords: ["dice", "game"], category: "activity" },
  { char: "🎯", name: "bullseye", keywords: ["target", "darts"], category: "activity" },
  { char: "🎮", name: "video game", keywords: ["game", "controller"], category: "activity" },
  { char: "🎨", name: "art", keywords: ["paint", "art"], category: "activity" },
  { char: "🎭", name: "theatre", keywords: ["theatre", "drama"], category: "activity" },
  { char: "🎤", name: "microphone", keywords: ["mic", "sing", "karaoke"], category: "activity" },
  { char: "🎧", name: "headphones", keywords: ["headphones", "music"], category: "activity" },
  { char: "🎵", name: "music note", keywords: ["music", "note"], category: "activity" },
  { char: "🎸", name: "guitar", keywords: ["guitar", "music"], category: "activity" },
  { char: "🎬", name: "clapper", keywords: ["movie", "film"], category: "activity" },
  { char: "📚", name: "books", keywords: ["books", "read", "library"], category: "activity" },
  { char: "🏋️", name: "lift", keywords: ["workout", "lifting", "gym"], category: "activity" },

  // Objects
  { char: "💻", name: "laptop", keywords: ["computer", "laptop", "work"], category: "objects" },
  { char: "📱", name: "phone", keywords: ["phone", "mobile"], category: "objects" },
  { char: "⌨️", name: "keyboard", keywords: ["keyboard"], category: "objects" },
  { char: "🖱️", name: "mouse", keywords: ["mouse"], category: "objects" },
  { char: "📷", name: "camera", keywords: ["camera", "photo"], category: "objects" },
  { char: "🔋", name: "battery", keywords: ["battery", "power"], category: "objects" },
  { char: "💡", name: "lightbulb", keywords: ["idea", "light"], category: "objects" },
  { char: "🔍", name: "magnifier", keywords: ["search", "find", "look"], category: "objects" },
  { char: "🔒", name: "lock", keywords: ["locked", "secure"], category: "objects" },
  { char: "🔑", name: "key", keywords: ["key", "unlock"], category: "objects" },
  { char: "📦", name: "package", keywords: ["box", "package"], category: "objects" },
  { char: "📌", name: "pin", keywords: ["pin", "pushpin"], category: "objects" },
  { char: "📝", name: "memo", keywords: ["note", "write", "memo"], category: "objects" },
  { char: "✏️", name: "pencil", keywords: ["pencil", "write"], category: "objects" },
  { char: "✂️", name: "scissors", keywords: ["cut", "scissors"], category: "objects" },
  { char: "📅", name: "calendar", keywords: ["calendar", "date"], category: "objects" },
  { char: "⏰", name: "alarm", keywords: ["alarm", "clock", "time"], category: "objects" },
  { char: "💰", name: "money bag", keywords: ["money", "cash"], category: "objects" },
  { char: "💳", name: "credit card", keywords: ["card", "payment"], category: "objects" },
  { char: "🎁", name: "gift", keywords: ["gift", "present"], category: "objects" },
  { char: "🛒", name: "cart", keywords: ["cart", "shopping"], category: "objects" },

  // Nature
  { char: "🌞", name: "sun", keywords: ["sun", "sunny"], category: "nature" },
  { char: "🌙", name: "moon", keywords: ["moon", "night"], category: "nature" },
  { char: "⭐️", name: "star", keywords: ["star"], category: "nature" },
  { char: "🌟", name: "glowing star", keywords: ["star", "shine"], category: "nature" },
  { char: "✨", name: "sparkles", keywords: ["sparkle", "magic"], category: "nature" },
  { char: "⚡️", name: "bolt", keywords: ["lightning", "fast"], category: "nature" },
  { char: "🔥", name: "fire", keywords: ["fire", "lit", "hot"], category: "nature" },
  { char: "💧", name: "drop", keywords: ["water", "drop"], category: "nature" },
  { char: "🌊", name: "wave", keywords: ["wave", "ocean", "water"], category: "nature" },
  { char: "🌈", name: "rainbow", keywords: ["rainbow", "pride"], category: "nature" },
  { char: "🌹", name: "rose", keywords: ["rose", "flower"], category: "nature" },
  { char: "🌻", name: "sunflower", keywords: ["sunflower", "flower"], category: "nature" },
  { char: "🌳", name: "tree", keywords: ["tree", "plant"], category: "nature" },
  { char: "🌲", name: "evergreen", keywords: ["tree", "evergreen"], category: "nature" },
  { char: "🍂", name: "leaves", keywords: ["leaves", "autumn", "fall"], category: "nature" },
  { char: "❄️", name: "snowflake", keywords: ["snow", "cold"], category: "nature" },

  // Symbols
  { char: "✅", name: "check", keywords: ["yes", "ok", "done"], category: "symbols" },
  { char: "❌", name: "cross", keywords: ["no", "wrong", "x"], category: "symbols" },
  { char: "⚠️", name: "warning", keywords: ["warning", "caution"], category: "symbols" },
  { char: "❗️", name: "exclamation", keywords: ["important", "alert"], category: "symbols" },
  { char: "❓", name: "question", keywords: ["question", "huh"], category: "symbols" },
  { char: "💯", name: "hundred", keywords: ["100", "perfect"], category: "symbols" },
  { char: "🚫", name: "no entry", keywords: ["banned", "no"], category: "symbols" },
  { char: "🔁", name: "repeat", keywords: ["loop", "repeat"], category: "symbols" },
  { char: "▶️", name: "play", keywords: ["play", "start"], category: "symbols" },
  { char: "⏸️", name: "pause", keywords: ["pause"], category: "symbols" },
  { char: "⏹️", name: "stop", keywords: ["stop"], category: "symbols" },
  { char: "🔔", name: "bell", keywords: ["bell", "notify"], category: "symbols" },
  { char: "🔕", name: "bell off", keywords: ["mute", "silent"], category: "symbols" },
];

export function searchEmojis(query: string, category: Category | "all"): EmojiEntry[] {
  const q = query.trim().toLowerCase();
  const pool = category === "all" ? EMOJIS : EMOJIS.filter((e) => e.category === category);
  if (!q) return pool;
  return pool.filter((e) => {
    if (e.name.includes(q)) return true;
    if (e.keywords.some((k) => k.includes(q))) return true;
    return false;
  });
}
