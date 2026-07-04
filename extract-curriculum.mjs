import fs from 'node:fs';

const source = fs.readFileSync('index.html', 'utf8');

function grabConst(name) {
  const start = source.indexOf(`const ${name} = `);
  if (start < 0) throw new Error(`Missing ${name}`);

  let depth = 0;
  let inString = '';
  let escaped = false;
  let seenEquals = false;

  for (let i = start; i < source.length; i += 1) {
    const ch = source[i];

    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === inString) inString = '';
      continue;
    }

    if (ch === '\'' || ch === '"' || ch === '`') {
      inString = ch;
      continue;
    }

    if (ch === '=' && !seenEquals) {
      seenEquals = true;
      continue;
    }

    if (!seenEquals) continue;

    if (ch === '[' || ch === '{') depth += 1;
    if (ch === ']' || ch === '}') depth -= 1;
    if (ch === ';' && depth === 0) return source.slice(start, i + 1);
  }

  throw new Error(`Could not find end of ${name}`);
}

const output = [
  `export ${grabConst('DOMAINS')}`,
  `export ${grabConst('SESSIONS')}`,
  `export ${grabConst('PORTFOLIO_ARTIFACTS')}`,
  '',
].join('\n\n');

fs.mkdirSync('src', { recursive: true });
fs.writeFileSync('src/curriculum.js', output);
console.log(`Wrote src/curriculum.js (${output.length} bytes)`);
