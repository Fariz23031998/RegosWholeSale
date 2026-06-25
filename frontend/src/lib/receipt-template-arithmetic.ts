const PURE_ARITHMETIC = /^[\s().\w+\-*/0-9]+$/;

const NUMERIC_HELPERS = new Set([
  "add",
  "div",
  "formatAmountInWords",
  "formatAmountWithCurrency",
  "formatAmountWithWords",
  "formatCurrency",
  "gt",
  "mul",
  "sub",
]);

function tokenize(expr: string): string[] {
  const tokens: string[] = [];
  let index = 0;

  while (index < expr.length) {
    const char = expr[index];
    if (/\s/.test(char)) {
      index += 1;
      continue;
    }

    if ("+-*/()".includes(char)) {
      tokens.push(char);
      index += 1;
      continue;
    }

    const numberMatch = expr.slice(index).match(/^\d+(\.\d+)?/);
    if (numberMatch) {
      tokens.push(numberMatch[0]);
      index += numberMatch[0].length;
      continue;
    }

    const identMatch = expr.slice(index).match(/^[a-zA-Z_@][\w.]*/);
    if (identMatch) {
      tokens.push(identMatch[0]);
      index += identMatch[0].length;
      continue;
    }

    throw new Error(`Invalid arithmetic expression near "${expr.slice(index, index + 12)}"`);
  }

  return tokens;
}

function parseExpression(tokens: string[], start: number): [string, number] {
  let [left, position] = parseTerm(tokens, start);

  while (position < tokens.length) {
    const operator = tokens[position];
    if (operator !== "+" && operator !== "-") break;
    const [right, nextPosition] = parseTerm(tokens, position + 1);
    left = operator === "+" ? `(add ${left} ${right})` : `(sub ${left} ${right})`;
    position = nextPosition;
  }

  return [left, position];
}

function parseTerm(tokens: string[], start: number): [string, number] {
  let [left, position] = parseFactor(tokens, start);

  while (position < tokens.length) {
    const operator = tokens[position];
    if (operator !== "*" && operator !== "/") break;
    const [right, nextPosition] = parseFactor(tokens, position + 1);
    left = operator === "*" ? `(mul ${left} ${right})` : `(div ${left} ${right})`;
    position = nextPosition;
  }

  return [left, position];
}

function parseFactor(tokens: string[], start: number): [string, number] {
  if (start >= tokens.length) {
    throw new Error("Unexpected end of arithmetic expression");
  }

  const token = tokens[start];
  if (token === "(") {
    const [inner, nextPosition] = parseExpression(tokens, start + 1);
    if (tokens[nextPosition] !== ")") {
      throw new Error("Expected closing parenthesis in arithmetic expression");
    }
    return [inner, nextPosition + 1];
  }

  if (token === "+" || token === "-" || token === "*" || token === "/" || token === ")") {
    throw new Error(`Unexpected operator "${token}" in arithmetic expression`);
  }

  return [token, start + 1];
}

export function arithmeticExpressionToHandlebars(expression: string): string {
  const tokens = tokenize(expression.trim());
  if (!tokens.length) {
    throw new Error("Empty arithmetic expression");
  }

  const [result, position] = parseExpression(tokens, 0);
  if (position !== tokens.length) {
    throw new Error("Unexpected trailing tokens in arithmetic expression");
  }

  return result;
}

function transformArithmeticTag(inner: string): string | null {
  const trimmed = inner.trim();
  if (!trimmed || !/[+*/-]/.test(trimmed)) return null;

  const helperPrefix = trimmed.match(/^([a-zA-Z]\w*)\s+(.+)$/);
  if (helperPrefix) {
    const [, helperName, remainder] = helperPrefix;
    if (NUMERIC_HELPERS.has(helperName) && PURE_ARITHMETIC.test(remainder)) {
      return `{{${helperName} ${arithmeticExpressionToHandlebars(remainder)}}}`;
    }
  }

  if (!PURE_ARITHMETIC.test(trimmed)) return null;

  return `{{${arithmeticExpressionToHandlebars(trimmed)}}}`;
}

export function preprocessArithmeticExpressions(html: string): string {
  return html.replace(/\{\{([^{}#/>][^}]*)\}\}/g, (match, inner: string) => {
    try {
      return transformArithmeticTag(inner) ?? match;
    } catch {
      return match;
    }
  });
}
