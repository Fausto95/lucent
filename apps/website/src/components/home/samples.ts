/** A run of a code sample: plain text, or text in one of the homepage's code colors. */
export type Token = string | { className: "kw" | "comment"; text: string };

const kw = (text: string): Token => ({ className: "kw", text });

const comment = (text: string): Token => ({ className: "comment", text });

/** A sample written as it reads, its colored runs interpolated where they appear. */
function code(text: TemplateStringsArray, ...runs: Token[]): Token[] {
  return text.flatMap((plain, i) => [plain, ...runs.slice(i, i + 1)]);
}

export const squareSource = code`${kw("export function")} square(x: number) {
  ${kw("return")} x * x;
}`;

export const squareCall = code`${kw("import")} { square } ${kw("from")} './math.lucent';

square(5); ${kw("// 25. Runs in C++.")}`;

export const likeLogic = code`${comment("// Shared logic, compiled to C++.")}
${kw("const")} liked = signal(false);
${kw("const")} toggle = () => liked.set(!liked.get());
${kw("const")} count = () =>
  props.count + (liked.get() ? 1 : 0);`;

export const likeSwiftUi = code`${kw("if")} (PLATFORM === "ios") {
  ${kw("return")} (
    <HStack spacing={6} onTapGesture={toggle}>
      <Image systemName={
        liked.get() ? "heart.fill" : "heart"
      } />
      <Text font={Font.headline}>
        {\`\${count()}\`}
      </Text>
    </HStack>
  );
}`;

export const likeCompose = code`${kw("return")} (
  <Row
    horizontalArrangement={
      Arrangement.spacedBy(dp(8))
    }
    verticalAlignment={Alignment.CenterVertically}
    modifier={Modifier.clickable(toggle)}
  >
    <CText text={liked.get() ? "♥" : "♡"}
      fontSize={sp(24)} />
    <CText text={\`\${count()}\`}
      fontSize={sp(17)}
      fontWeight={FontWeight.Bold} />
  </Row>
);`;

export const likeImport = code`${kw("import")} { Like } ${kw("from")} './like.lucent';

<Like count={41} />`;

export const install = code`npm install -D @lucent-lang/lucent
npx lucent init`;
