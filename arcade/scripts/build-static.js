// Build da Vercel: gera public/games/index.json (lista de jogos da galeria)
// a partir do game.json de cada pasta em public/games.
const fs = require('fs');
const path = require('path');

const GAMES_DIR = path.join(__dirname, '..', 'public', 'games');
const games = [];
for (const d of fs.readdirSync(GAMES_DIR, { withFileTypes: true })) {
  if (!d.isDirectory()) continue;
  try {
    const meta = JSON.parse(fs.readFileSync(path.join(GAMES_DIR, d.name, 'game.json'), 'utf8'));
    games.push({ ...meta, id: d.name });
  } catch { /* pasta sem game.json válido */ }
}
games.sort((a, b) => (a.order ?? 99) - (b.order ?? 99) || a.name.localeCompare(b.name));
fs.writeFileSync(path.join(GAMES_DIR, 'index.json'), JSON.stringify(games, null, 2));
console.log(`games/index.json: ${games.map((g) => g.name).join(', ')}`);
