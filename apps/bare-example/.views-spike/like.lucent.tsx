import { PLATFORM } from "lucent:platform";
import { Animation, Color, Font, HStack, Image, Text } from "lucent:swiftui";
import { Alignment, animateFloatAsState, Color as CColor, Modifier, Row, spring, Spring, Text as CText } from "lucent:compose";
import { signal } from "lucent:ui";

export function Like(props: { count: number }) {
  const liked = signal(false);
  const toggle = () => liked.set(!liked.get());
  const count = () => props.count + (liked.get() ? 1 : 0);

  if (PLATFORM === "ios") {
    return (
      <HStack spacing={6} onTapGesture={toggle}>
        <Image
          systemName={liked.get() ? "heart.fill" : "heart"}
          foregroundStyle={liked.get() ? Color.pink : Color.gray}
          scaleEffect={liked.get() ? 1.3 : 1}
          animation={[Animation.spring({ response: 0.3, dampingFraction: 0.4 }), { value: liked.get() }]}
        />
        <Text font={Font.headline}>{`${count()}`}</Text>
      </HStack>
    );
  }

  const pop = animateFloatAsState(liked.get() ? 1.3 : 1, spring({ dampingRatio: Spring.DampingRatioHighBouncy }));

  return (
    <Row verticalAlignment={Alignment.CenterVertically} modifier={Modifier.clickable(toggle)}>
      <CText text={liked.get() ? "♥" : "♡"} color={liked.get() ? CColor(0xffe91e63) : CColor.Gray} modifier={Modifier.scale(pop.value)} />
      <CText text={`${count()}`} />
    </Row>
  );
}
